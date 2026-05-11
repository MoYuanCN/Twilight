"""
管理服务模块

批量操作、数据导出、统计等管理功能
"""
import csv
import json
import logging
from io import StringIO
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime
from sqlalchemy import select, func

from src.db.user import UserOperate, UserModel, Role
from src.db.playback import PlaybackOperate, DailyStatsOperate, PlaybackSessionFactory, PlaybackModel
from src.services.emby import get_emby_client
from src.services.user_service import UserService
from src.core.utils import timestamp, format_duration, days_to_seconds

logger = logging.getLogger(__name__)


class BatchOperationService:
    """批量操作服务"""
    
    @classmethod
    async def batch_disable_users(cls, uids: List[int], reason: str = "") -> Dict[str, Any]:
        """
        批量禁用用户
        
        :param uids: 用户 UID 列表
        :param reason: 禁用原因
        :return: 操作结果
        """
        success = 0
        failed = 0
        errors = []
        
        emby = get_emby_client()
        
        for uid in uids:
            try:
                user = await UserOperate.get_user_by_uid(uid)
                if not user:
                    failed += 1
                    errors.append(f"UID {uid}: 用户不存在")
                    continue
                
                # 禁用 Emby
                if user.EMBYID:
                    await emby.set_user_enabled(user.EMBYID, False)
                
                # 禁用本地
                await UserOperate.update_user(uid=uid, active_status=False)
                success += 1
                
            except Exception as e:
                failed += 1
                errors.append(f"UID {uid}: {str(e)}")
        
        logger.info(f"批量禁用用户: 成功 {success}, 失败 {failed}, 原因: {reason}")
        
        return {
            'total': len(uids),
            'success': success,
            'failed': failed,
            'errors': errors,
        }
    
    @classmethod
    async def batch_enable_users(cls, uids: List[int]) -> Dict[str, Any]:
        """批量启用用户"""
        success = 0
        failed = 0
        errors = []
        
        emby = get_emby_client()
        
        for uid in uids:
            try:
                user = await UserOperate.get_user_by_uid(uid)
                if not user:
                    failed += 1
                    errors.append(f"UID {uid}: 用户不存在")
                    continue
                
                if user.EMBYID:
                    await emby.set_user_enabled(user.EMBYID, True)
                
                await UserOperate.update_user(uid=uid, active_status=True)
                success += 1
                
            except Exception as e:
                failed += 1
                errors.append(f"UID {uid}: {str(e)}")
        
        return {
            'total': len(uids),
            'success': success,
            'failed': failed,
            'errors': errors,
        }
    
    @classmethod
    async def batch_renew_users(cls, uids: List[int], days: int) -> Dict[str, Any]:
        """批量续期用户"""
        success = 0
        failed = 0
        errors = []
        
        for uid in uids:
            try:
                user = await UserOperate.get_user_by_uid(uid)
                if not user:
                    failed += 1
                    errors.append(f"UID {uid}: 用户不存在")
                    continue
                
                ok, msg = await UserService.renew(uid, days)
                if ok:
                    success += 1
                else:
                    failed += 1
                    errors.append(f"UID {uid}: {msg}")
                    
            except Exception as e:
                failed += 1
                errors.append(f"UID {uid}: {str(e)}")
        
        logger.info(f"批量续期用户: 成功 {success}, 失败 {failed}, 天数: {days}")
        
        return {
            'total': len(uids),
            'success': success,
            'failed': failed,
            'days': days,
            'errors': errors,
        }
    
    @classmethod
    async def batch_delete_users(cls, uids: List[int], delete_emby: bool = True) -> Dict[str, Any]:
        """批量删除用户"""
        success = 0
        failed = 0
        errors = []
        
        for uid in uids:
            try:
                user = await UserOperate.get_user_by_uid(uid)
                if not user:
                    failed += 1
                    errors.append(f"UID {uid}: 用户不存在")
                    continue
                
                ok, msg = await UserService.delete_user(user, delete_emby)
                if ok:
                    success += 1
                else:
                    failed += 1
                    errors.append(f"UID {uid}: {msg}")
                    
            except Exception as e:
                failed += 1
                errors.append(f"UID {uid}: {str(e)}")
        
        logger.info(f"批量删除用户: 成功 {success}, 失败 {failed}")
        
        return {
            'total': len(uids),
            'success': success,
            'failed': failed,
            'errors': errors,
        }
    
class DataExportService:
    """数据导出服务"""
    
    @classmethod
    async def export_users_csv(
        cls,
        include_playback: bool = False,
        active_only: bool = False
    ) -> str:
        """
        导出用户数据为 CSV
        
        :return: CSV 字符串
        """
        users, _ = await UserOperate.get_all_users(limit=10000, active_status=True if active_only else None)
        
        output = StringIO()
        
        # CSV 字段
        fields = [
            'UID', '用户名', 'Telegram ID', '邮箱', '角色', '状态',
            '注册时间', '到期时间', 'Emby ID'
        ]
        
        if include_playback:
            fields.extend(['总播放时长', '播放次数'])
        
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()
        
        role_map = {
            Role.ADMIN.value: '管理员',
            Role.WHITELIST.value: '白名单',
            Role.NORMAL.value: '普通用户',
        }
        
        for user in users:
            row = {
                'UID': user.UID,
                '用户名': user.USERNAME,
                'Telegram ID': user.TELEGRAM_ID or '',
                '邮箱': user.EMAIL or '',
                '角色': role_map.get(user.ROLE, '未知'),
                '状态': '活跃' if user.ACTIVE_STATUS else '禁用',
                '注册时间': datetime.fromtimestamp(user.REGISTER_TIME).strftime('%Y-%m-%d %H:%M:%S') if user.REGISTER_TIME else '',
                '到期时间': '永久' if user.EXPIRED_AT == -1 else datetime.fromtimestamp(user.EXPIRED_AT).strftime('%Y-%m-%d %H:%M:%S') if user.EXPIRED_AT else '',
                'Emby ID': user.EMBYID or '',
            }
            
            if include_playback:
                duration = await PlaybackOperate.get_user_total_duration(user.UID)
                count = await PlaybackOperate.get_user_play_count(user.UID)
                row['总播放时长'] = format_duration(duration)
                row['播放次数'] = count
            
            writer.writerow(row)
        
        return output.getvalue()
    
    @classmethod
    async def export_users_json(cls) -> str:
        """导出用户数据为 JSON"""
        users, _ = await UserOperate.get_all_users(limit=10000)
        
        data = []
        for user in users:
            user_data = {
                'uid': user.UID,
                'username': user.USERNAME,
                'telegram_id': user.TELEGRAM_ID,
                'email': user.EMAIL,
                'role': user.ROLE,
                'active': user.ACTIVE_STATUS,
                'register_time': user.REGISTER_TIME,
                'expired_at': user.EXPIRED_AT,
                'emby_id': user.EMBYID,
            }

            data.append(user_data)
        
        return json.dumps(data, ensure_ascii=False, indent=2)
    
    @classmethod
    async def export_playback_stats_csv(cls, days: int = 30) -> str:
        """导出播放统计为 CSV。"""
        output = StringIO()
        
        fields = ['UID', '用户名', '播放时长', '播放次数']
        writer = csv.DictWriter(output, fieldnames=fields)
        writer.writeheader()

        users, _ = await UserOperate.get_all_users(limit=10000)
        username_map = {user.UID: user.USERNAME for user in users}

        async with PlaybackSessionFactory() as session:
            query = (
                select(
                    PlaybackModel.UID.label('uid'),
                    func.coalesce(func.sum(PlaybackModel.DURATION), 0).label('total_duration'),
                    func.count().label('play_count'),
                )
                .group_by(PlaybackModel.UID)
            )

            if days > 0:
                start_time = timestamp() - days * 86400
                query = query.where(PlaybackModel.START_TIME >= start_time)

            rows = (await session.execute(query)).all()

        for item in sorted(rows, key=lambda row: int(row.uid)):
            writer.writerow({
                'UID': item.uid,
                '用户名': username_map.get(item.uid, '未知'),
                '播放时长': format_duration(int(item.total_duration or 0)),
                '播放次数': int(item.play_count or 0),
            })
        
        return output.getvalue()


class WatchHistoryService:
    """观看历史统计服务"""
    
    @classmethod
    async def get_user_watch_stats(cls, uid: int) -> Dict[str, Any]:
        """
        获取用户观看统计
        
        :return: 统计数据
        """
        total_duration = await PlaybackOperate.get_user_total_duration(uid)
        play_count = await PlaybackOperate.get_user_play_count(uid)
        recent_plays = await PlaybackOperate.get_user_playback(uid, limit=10)
        
        # 统计媒体类型
        type_stats = {}
        for play in recent_plays:
            media_type = play.ITEM_TYPE or 'unknown'
            if media_type not in type_stats:
                type_stats[media_type] = {'count': 0, 'duration': 0}
            type_stats[media_type]['count'] += 1
            type_stats[media_type]['duration'] += play.DURATION
        
        return {
            'total_duration': total_duration,
            'total_duration_str': format_duration(total_duration),
            'play_count': play_count,
            'type_stats': type_stats,
            'recent_plays': [{
                'item_name': p.ITEM_NAME,
                'item_type': p.ITEM_TYPE,
                'series_name': p.SERIES_NAME,
                'duration': p.DURATION,
                'duration_str': format_duration(p.DURATION),
                'start_time': p.START_TIME,
                'device': p.DEVICE_NAME,
            } for p in recent_plays],
        }
    
    @classmethod
    async def get_global_watch_stats(cls, days: int = 7) -> Dict[str, Any]:
        """获取全站观看统计。"""
        start_time = timestamp() - days * 86400

        async with PlaybackSessionFactory() as session:
            count_query = select(func.count()).select_from(PlaybackModel).where(PlaybackModel.START_TIME >= start_time)
            duration_query = select(func.coalesce(func.sum(PlaybackModel.DURATION), 0)).where(PlaybackModel.START_TIME >= start_time)
            active_user_query = select(func.count(func.distinct(PlaybackModel.UID))).where(PlaybackModel.START_TIME >= start_time)

            total_play_count = (await session.execute(count_query)).scalar_one() or 0
            total_duration = (await session.execute(duration_query)).scalar_one() or 0
            active_user_count = (await session.execute(active_user_query)).scalar_one() or 0

        return {
            'period_days': days,
            'total_play_count': total_play_count,
            'total_duration': total_duration,
            'total_duration_str': format_duration(total_duration),
            'active_user_count': active_user_count,
        }


class ReminderService:
    """提醒服务"""
    
    @classmethod
    async def get_expiring_users(cls, days: int = 3) -> List[Dict[str, Any]]:
        """
        获取即将到期的用户
        
        :param days: 几天内到期
        :return: 用户列表
        """
        users = await UserOperate.get_expiring_users(days)
        
        result = []
        for user in users:
            remaining = user.EXPIRED_AT - timestamp()
            result.append({
                'uid': user.UID,
                'username': user.USERNAME,
                'telegram_id': user.TELEGRAM_ID,
                'expired_at': user.EXPIRED_AT,
                'remaining_seconds': remaining,
                'remaining_str': format_duration(remaining),
            })
        
        return result
    
    @classmethod
    async def send_expiry_reminders(cls) -> Dict[str, Any]:
        """
        发送到期提醒
        
        :return: 发送结果
        """
        from src.config import Config
        
        if not Config.TELEGRAM_MODE:
            return {'sent': 0, 'message': 'Telegram 模式未启用'}
        
        expiring_users = await cls.get_expiring_users(days=3)
        
        if not expiring_users:
            return {'sent': 0, 'message': '没有即将到期的用户'}
        
        sent = 0
        
        for user in expiring_users:
            if not user['telegram_id']:
                continue
            
            try:
                from src.services.notification import NotificationService, Notification, NotificationType
                
                await NotificationService.send(Notification(
                    type=NotificationType.USER_EXPIRED,
                    title="⏰ 账号即将到期",
                    content=f"您的账号将在 {user['remaining_str']} 后到期，请及时续期！",
                    target_users=[user['telegram_id']]
                ))
                sent += 1
            except Exception as e:
                logger.error(f"发送到期提醒失败: {user['username']} - {e}")
        
        return {'sent': sent, 'total': len(expiring_users)}

