"""
统计 API

播放统计相关接口
"""
from flask import Blueprint, g

from src.api.v1.auth import require_auth, require_admin, api_response
from src.services.stats_service import StatsService

stats_bp = Blueprint('stats', __name__, url_prefix='/stats')


# ==================== 个人统计 ====================

@stats_bp.route('/me', methods=['GET'])
@require_auth
async def get_my_stats():
    """
    获取我的播放统计
    
    Response:
        {
            "success": true,
            "data": {
                "uid": 1,
                "username": "test",
                "total": {
                    "duration": 36000,
                    "duration_str": "10小时",
                    "play_count": 50
                },
                "today": {
                    "duration": 3600,
                    "duration_str": "1小时",
                    "play_count": 5
                }
            }
        }
    """
    stats = await StatsService.get_user_stats(g.current_user.UID)
    
    if stats:
        return api_response(True, "获取成功", stats)
    return api_response(False, "获取失败", code=500)


@stats_bp.route('/user/<int:uid>', methods=['GET'])
@require_auth
async def get_user_stats(uid: int):
    """获取指定用户的统计（需要登录）"""
    stats = await StatsService.get_user_stats(uid)
    
    if stats:
        return api_response(True, "获取成功", stats)
    return api_response(False, "用户不存在", code=404)


