"""
Bangumi 同步服务

通过播放记录数据实现观看记录同步到 Bangumi
参考: https://github.com/SanaeMio/Bangumi-syncer
"""
import json
import logging
import re
from typing import Optional, Dict, Any, List
from dataclasses import dataclass
from difflib import SequenceMatcher

from src.db.bangumi import BangumiUserModel, BangumiUserOperate
from src.db.user import UserOperate
from src.services.bangumi import (
    BangumiClient, BangumiSubject, BangumiError,
    get_bangumi_client, SubjectType, EpStatus
)
from src.services.bangumi_search import BangumiSearchAPI

logger = logging.getLogger(__name__)


@dataclass
class SyncRequest:
    """同步请求数据"""
    media_type: str           # episode
    title: str                # 中文名
    original_title: str       # 原名
    season: int               # 季度
    episode: int              # 集数
    release_date: str         # 发布日期 YYYY-MM-DD
    user_name: str            # 用户名
    source: str = 'api'       # 来源标识（如 api/manual）
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'SyncRequest':
        return cls(
            media_type=data.get('media_type', 'episode'),
            title=data.get('title', ''),
            original_title=data.get('ori_title', data.get('original_title', '')),
            season=int(data.get('season', 1) or 1),
            episode=int(data.get('episode', 0) or 0),
            release_date=data.get('release_date', ''),
            user_name=data.get('user_name', ''),
            source=data.get('source', 'api'),
        )


@dataclass
class SyncResult:
    """同步结果"""
    success: bool
    message: str
    subject_id: Optional[int] = None
    subject_name: Optional[str] = None
    episode: Optional[int] = None


class BangumiSyncService:
    """Bangumi 同步服务"""
    
    # 自定义映射缓存 (title -> subject_id)
    _custom_mappings: Dict[str, int] = {}
    
    # 搜索缓存 (title -> subject_id)
    _search_cache: Dict[str, int] = {}
    _search_cache_time: Dict[str, float] = {}
    _search_cache_ttl_seconds: float = 3600.0
    
    # 屏蔽关键词
    _block_keywords: List[str] = []
    
    @classmethod
    def set_block_keywords(cls, keywords: List[str]) -> None:
        """设置屏蔽关键词"""
        cls._block_keywords = [k.lower() for k in keywords]
    
    @classmethod
    def add_custom_mapping(cls, title: str, subject_id: int) -> None:
        """添加自定义映射"""
        cls._custom_mappings[title.lower()] = subject_id
    
    @classmethod
    def remove_custom_mapping(cls, title: str) -> bool:
        """移除自定义映射"""
        key = title.lower()
        if key in cls._custom_mappings:
            del cls._custom_mappings[key]
            return True
        return False
    
    @classmethod
    def get_custom_mappings(cls) -> Dict[str, int]:
        """获取所有自定义映射"""
        return cls._custom_mappings.copy()
    
    @classmethod
    def load_mappings_from_json(cls, json_str: str) -> int:
        """从 JSON 加载映射"""
        try:
            mappings = json.loads(json_str)
            count = 0
            for title, subject_id in mappings.items():
                cls._custom_mappings[title.lower()] = int(subject_id)
                count += 1
            return count
        except Exception as e:
            logger.error(f"加载映射失败: {e}")
            return 0
    
    @classmethod
    def export_mappings_to_json(cls) -> str:
        """导出映射为 JSON"""
        return json.dumps(cls._custom_mappings, ensure_ascii=False, indent=2)
    
    @classmethod
    def _is_blocked(cls, title: str) -> bool:
        """检查是否被屏蔽"""
        title_lower = title.lower()
        for keyword in cls._block_keywords:
            if keyword in title_lower:
                return True
        return False
    
    @classmethod
    def _normalize_title(cls, title: str) -> str:
        """标准化标题"""
        # 去除季度标识
        title = re.sub(r'\s*第?[一二三四五六七八九十\d]+季\s*', '', title)
        title = re.sub(r'\s*Season\s*\d+\s*', '', title, flags=re.IGNORECASE)
        title = re.sub(r'\s*S\d+\s*', '', title, flags=re.IGNORECASE)
        # 去除特殊字符
        title = re.sub(r'[【】\[\]()（）]', '', title)
        return title.strip()
    
    @classmethod
    def _similarity(cls, a: str, b: str) -> float:
        """计算字符串相似度"""
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()
    
    @classmethod
    async def _search_subject(
        cls,
        title: str,
        original_title: str,
        release_date: str,
        season: int = 1
    ) -> Optional[int]:
        """搜索匹配的 Bangumi 条目"""
        
        # 1. 先检查自定义映射
        title_lower = title.lower()
        if title_lower in cls._custom_mappings:
            return cls._custom_mappings[title_lower]
        
        # 2. 检查缓存
        cache_key = f"{title}:{season}"
        import time as _time
        if cache_key in cls._search_cache:
            cached_at = cls._search_cache_time.get(cache_key, 0)
            if (_time.time() - cached_at) < cls._search_cache_ttl_seconds:
                return cls._search_cache[cache_key]
            cls._search_cache.pop(cache_key, None)
            cls._search_cache_time.pop(cache_key, None)
        
        client = get_bangumi_client()
        
        # 3. 使用标题搜索
        normalized_title = cls._normalize_title(title)
        search_terms = [normalized_title]
        
        # 添加原名搜索
        if original_title and original_title != title:
            search_terms.append(cls._normalize_title(original_title))
        
        # 提取年份
        year = release_date[:4] if release_date and len(release_date) >= 4 else None
        
        best_match: Optional[BangumiSubject] = None
        best_score = 0.0
        
        for search_term in search_terms:
            if not search_term:
                continue
            
            try:
                results = await client.search(search_term, SubjectType.ANIME, limit=10)
                
                for subject in results:
                    score = 0.0
                    
                    # 标题相似度
                    title_sim = max(
                        cls._similarity(search_term, subject.name),
                        cls._similarity(search_term, subject.name_cn) if subject.name_cn else 0
                    )
                    score += title_sim * 0.6
                    
                    # 年份匹配
                    if year and subject.air_date:
                        subject_year = subject.air_date[:4]
                        if year == subject_year:
                            score += 0.2
                        elif abs(int(year) - int(subject_year)) == 1:
                            score += 0.1
                    
                    # 类型加分（动画）
                    if subject.type == 2:
                        score += 0.1
                    
                    # 评分加分
                    if subject.score > 7:
                        score += 0.1
                    
                    if score > best_score:
                        best_score = score
                        best_match = subject
                
            except BangumiError as e:
                logger.warning(f"Bangumi 搜索失败: {e}")
                continue
        
        if best_match and best_score > 0.5:
            cls._search_cache[cache_key] = best_match.id
            cls._search_cache_time[cache_key] = _time.time()
            logger.info(f"匹配到 Bangumi 条目: {title} -> {best_match.title} (ID: {best_match.id}, 相似度: {best_score:.2f})")
            return best_match.id

        # 4. 回退到更强的智能搜索策略，提升疑难标题命中率
        try:
            smart_match = await BangumiSearchAPI.search_subject(
                name=title,
                subject_type=SubjectType.ANIME.value,
            )
            if smart_match:
                cls._search_cache[cache_key] = smart_match.id
                cls._search_cache_time[cache_key] = _time.time()
                logger.info(f"智能回退匹配成功: {title} -> {smart_match.title} (ID: {smart_match.id})")
                return smart_match.id
        except Exception as e:
            logger.warning(f"智能回退搜索失败: {e}")
        
        logger.warning(f"未能匹配 Bangumi 条目: {title}")
        return None
    
    @classmethod
    async def sync_episode(
        cls,
        request: SyncRequest,
        bgm_token: str
    ) -> SyncResult:
        """
        同步单集观看记录到 Bangumi
        
        :param request: 同步请求
        :param bgm_token: 用户的 Bangumi Access Token
        """
        # 检查基本信息
        if not request.title:
            return SyncResult(False, "缺少番剧标题")
        
        if request.episode <= 0:
            return SyncResult(False, "无效的集数")
        
        # 检查是否被屏蔽
        if cls._is_blocked(request.title):
            return SyncResult(False, f"番剧 '{request.title}' 在屏蔽列表中")
        
        # 搜索条目
        subject_id = await cls._search_subject(
            request.title,
            request.original_title,
            request.release_date,
            request.season
        )
        
        if not subject_id:
            return SyncResult(False, f"未找到匹配的 Bangumi 条目: {request.title}")
        
        # 使用用户的 token 创建客户端
        client = BangumiClient(access_token=bgm_token)
        
        try:
            # 获取条目信息
            subject = await client.get_subject(subject_id)
            if not subject:
                return SyncResult(False, f"无法获取 Bangumi 条目信息: {subject_id}")
            
            # 确保用户已收藏该条目（设为"在看"）
            try:
                collection = await client.get_user_collection(subject_id)
                if not collection:
                    # 添加到收藏
                    await client.update_collection(subject_id, status=3)  # 3=在看
                    logger.info(f"已将 {subject.title} 添加到收藏")
            except BangumiError:
                # 尝试添加收藏
                await client.update_collection(subject_id, status=3)
            
            # 计算实际集数（考虑季度）
            actual_episode = request.episode
            # 对于多季番剧，可能需要额外处理
            # 这里简单处理，如果是第二季以上，尝试获取前几季的集数
            
            # 标记为已看
            success = await client.mark_episode_by_ep_number(
                subject_id,
                actual_episode,
                EpStatus.WATCHED
            )
            
            if success:
                logger.info(f"✅ 同步成功: {subject.title} 第 {actual_episode} 集")
                return SyncResult(
                    success=True,
                    message=f"已同步: {subject.title} 第 {actual_episode} 集",
                    subject_id=subject_id,
                    subject_name=subject.title,
                    episode=actual_episode
                )
            else:
                return SyncResult(
                    success=False,
                    message=f"标记失败: {subject.title} 第 {actual_episode} 集",
                    subject_id=subject_id
                )
            
        except BangumiError as e:
            logger.error(f"Bangumi 同步错误: {e}")
            return SyncResult(False, f"同步失败: {e}")
        finally:
            await client.close()
    
    @classmethod
    async def _get_user_bgm_token(cls, user) -> Optional[str]:
        """获取用户 Bangumi Token，优先使用个人设置。"""
        if user.BGM_TOKEN:
            return user.BGM_TOKEN
        if user.TELEGRAM_ID:
            bgm_user = await BangumiUserOperate.get_user(user.TELEGRAM_ID)
            if bgm_user and bgm_user.access_token:
                return bgm_user.access_token
        return None

    @classmethod
    async def sync_for_user(
        cls,
        uid: int,
        title: str,
        season: int,
        episode: int,
        original_title: str = '',
        release_date: str = ''
    ) -> SyncResult:
        """
        为指定用户同步观看记录
        
        :param uid: 用户 UID
        :param title: 番剧标题
        :param season: 季度
        :param episode: 集数
        """
        user = await UserOperate.get_user_by_uid(uid)
        if not user:
            return SyncResult(False, "用户不存在")
        
        if not user.BGM_MODE:
            return SyncResult(False, "用户未开启 Bangumi 同步")

        token = await cls._get_user_bgm_token(user)
        if not token:
            return SyncResult(False, "用户未绑定 Bangumi 账号")
        
        request = SyncRequest(
            media_type='episode',
            title=title,
            original_title=original_title,
            season=season,
            episode=episode,
            release_date=release_date,
            user_name=user.USERNAME,
            source='api'
        )
        
        return await cls.sync_episode(request, token)


