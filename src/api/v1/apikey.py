"""
API Key 专用接口

提供基于 API Key 认证的外部接口，用于外部系统控制账号
这些接口与前端使用的接口完全独立

权限范围 (permissions):
  account:read  - 读取账号信息、状态
  account:write - 启用/禁用/续期账号
  emby:read     - 读取 Emby 状态
  emby:write    - 控制 Emby 账户（NSFW 等）
"""
import json
from functools import wraps
from typing import Callable, Any, List
from flask import Blueprint, request, g

from src.api.v1.auth import api_response
from src.db.user import UserOperate, UserModel
from src.services import UserService, EmbyService

apikey_bp = Blueprint('apikey', __name__, url_prefix='/apikey')

# 所有可用的权限范围
ALL_PERMISSIONS = [
    'account:read', 'account:write',
    'emby:read', 'emby:write',
]


def _get_user_permissions(user: UserModel) -> List[str]:
    """获取用户 API Key 的权限列表"""
    if not user.APIKEY_PERMISSIONS:
        # 默认权限：向后兼容，旧 Key 拥有全部权限
        return list(ALL_PERMISSIONS)
    try:
        perms = json.loads(user.APIKEY_PERMISSIONS)
        return [p for p in perms if p in ALL_PERMISSIONS]
    except (json.JSONDecodeError, TypeError):
        return list(ALL_PERMISSIONS)


def require_apikey(f: Callable) -> Callable:
    """
    API Key 认证装饰器

    从请求头中获取 X-API-Key 或 Authorization: Bearer <apikey> 进行认证。
    优先匹配多密钥表 (ApiKeyModel)，回退到旧的 UserModel.APIKEY 单密钥字段。
    """
    @wraps(f)
    async def wrapper(*args, **kwargs):
        import time as _time
        from src.db.apikey import ApiKeyOperate

        apikey = request.headers.get('X-API-Key')

        if not apikey:
            auth_header = request.headers.get('Authorization', '')
            if auth_header.startswith('Bearer '):
                apikey = auth_header[7:]
            elif auth_header.startswith('ApiKey '):
                apikey = auth_header[7:]

        if not apikey:
            return api_response(False, "缺少 API Key，请在请求头中提供 X-API-Key 或 Authorization: Bearer <apikey>", code=401)

        if not apikey.startswith('key-') or len(apikey) < 20:
            return api_response(False, "API Key 格式无效", code=401)

        user = None
        permissions: List[str] = list(ALL_PERMISSIONS)
        multi_key = await ApiKeyOperate.get_api_key_by_plaintext(apikey)

        if multi_key:
            if not multi_key.ENABLED:
                return api_response(False, "API Key 已禁用", code=403)
            if multi_key.EXPIRED_AT and multi_key.EXPIRED_AT > 0 and multi_key.EXPIRED_AT < int(_time.time()):
                return api_response(False, "API Key 已过期", code=403)
            user = await UserOperate.get_user_by_uid(multi_key.UID)
            stored_perms = ApiKeyOperate.get_permissions(multi_key)
            if stored_perms:
                permissions = [p for p in stored_perms if p in ALL_PERMISSIONS]
            elif not multi_key.ALLOW_QUERY:
                permissions = []
            await ApiKeyOperate.touch_usage(multi_key.ID)
        else:
            user = await UserOperate.get_user_by_apikey(apikey)
            if user:
                if not user.APIKEY_STATUS:
                    return api_response(False, "API Key 已禁用", code=403)
                permissions = _get_user_permissions(user)

        if not user:
            return api_response(False, "API Key 无效或已禁用", code=401)

        if not user.ACTIVE_STATUS:
            return api_response(False, "账户已被禁用", code=403)

        g.current_user = user
        g.apikey = apikey
        g.apikey_permissions = permissions

        return await f(*args, **kwargs)

    return wrapper


def require_permission(*perms: str):
    """
    API Key 权限检查装饰器
    
    用法: @require_permission('account:read')
    """
    def decorator(f: Callable) -> Callable:
        @wraps(f)
        async def wrapper(*args, **kwargs):
            user_perms = getattr(g, 'apikey_permissions', [])
            missing = [p for p in perms if p not in user_perms]
            if missing:
                return api_response(False, f"API Key 缺少权限: {', '.join(missing)}", code=403)
            return await f(*args, **kwargs)
        return wrapper
    return decorator


# ==================== 账号信息 ====================

@apikey_bp.route('/info', methods=['GET'])
@require_apikey
@require_permission('account:read')
async def get_account_info():
    """
    获取账号信息
    
    Headers:
        X-API-Key: <your_api_key>
        或
        Authorization: Bearer <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "获取成功",
            "data": {
                "uid": 1,
                "username": "user123",
                "email": "user@example.com",
                "role": 1,
                "role_name": "NORMAL",
                "active": true,
                "emby_id": "xxx",
                "expired_at": 1735689600,
                "is_expired": false,
                "is_permanent": false,
                "days_left": 30
            }
        }
    """
    user = g.current_user
    
    # 计算到期信息
    expired_at = user.EXPIRED_AT
    is_expired = False
    is_permanent = False
    days_left = 0
    
    if expired_at and expired_at > 0:
        if expired_at == 253402214400:  # 9999-12-31
            is_permanent = True
        else:
            import time
            current_time = int(time.time())
            is_expired = expired_at < current_time
            if not is_expired:
                days_left = max(0, (expired_at - current_time) // 86400)
    
    return api_response(True, "获取成功", {
        'uid': user.UID,
        'username': user.USERNAME,
        'email': user.EMAIL,
        'role': user.ROLE,
        'role_name': {0: 'ADMIN', 1: 'NORMAL', 2: 'WHITE_LIST', -1: 'UNRECOGNIZED'}.get(user.ROLE, 'UNKNOWN'),
        'active': user.ACTIVE_STATUS,
        'emby_id': user.EMBYID,
        'expired_at': expired_at,
        'is_expired': is_expired,
        'is_permanent': is_permanent,
        'days_left': days_left,
    })


@apikey_bp.route('/status', methods=['GET'])
@require_apikey
@require_permission('account:read')
async def get_account_status():
    """
    获取账号状态（简化版）
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "获取成功",
            "data": {
                "active": true,
                "emby_id": "xxx",
                "is_expired": false,
                "days_left": 30
            }
        }
    """
    user = g.current_user
    
    # 计算到期信息
    expired_at = user.EXPIRED_AT
    is_expired = False
    days_left = 0
    
    if expired_at and expired_at > 0 and expired_at != 253402214400:
        import time
        current_time = int(time.time())
        is_expired = expired_at < current_time
        if not is_expired:
            days_left = max(0, (expired_at - current_time) // 86400)
    
    return api_response(True, "获取成功", {
        'active': user.ACTIVE_STATUS,
        'emby_id': user.EMBYID,
        'is_expired': is_expired,
        'days_left': days_left if expired_at != 253402214400 else -1,  # -1 表示永久
    })


# ==================== 账号控制 ====================

@apikey_bp.route('/enable', methods=['POST'])
@require_apikey
@require_permission('account:write')
async def enable_account():
    """
    启用账号
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "账号已启用",
            "data": {
                "uid": 1,
                "active": true
            }
        }
    """
    user = g.current_user
    
    if user.ACTIVE_STATUS:
        return api_response(False, "账号已经是启用状态", code=400)
    
    user.ACTIVE_STATUS = True
    await UserOperate.update_user(user)
    
    return api_response(True, "账号已启用", {
        'uid': user.UID,
        'active': True,
    })


@apikey_bp.route('/disable', methods=['POST'])
@require_apikey
@require_permission('account:write')
async def disable_account():
    """
    禁用账号
    
    Headers:
        X-API-Key: <your_api_key>
    
    Request (可选):
        {
            "reason": "违规操作"
        }
    
    Response:
        {
            "success": true,
            "message": "账号已禁用",
            "data": {
                "uid": 1,
                "active": false
            }
        }
    """
    user = g.current_user
    
    if not user.ACTIVE_STATUS:
        return api_response(False, "账号已经是禁用状态", code=400)
    
    data = request.get_json() or {}
    reason = data.get('reason', '通过 API Key 接口禁用')
    
    success, message = await UserService.disable_user(user, reason)
    if success:
        return api_response(True, message, {
            'uid': user.UID,
            'active': False,
        })
    return api_response(False, message, code=400)


@apikey_bp.route('/renew', methods=['POST'])
@require_apikey
@require_permission('account:write')
async def renew_account():
    """
    续期账号
    
    Headers:
        X-API-Key: <your_api_key>
    
    Request:
        {
            "days": 30  // 续期天数，必填
        }
    
    Response:
        {
            "success": true,
            "message": "续期成功",
            "data": {
                "uid": 1,
                "expired_at": 1735689600,
                "days_left": 30
            }
        }
    """
    user = g.current_user
    data = request.get_json() or {}
    days = data.get('days')
    
    if not days:
        return api_response(False, "缺少 days 参数", code=400)
    
    if days <= 0:
        return api_response(False, "续期天数必须大于0", code=400)
    
    if days > 3650:  # 限制最多续期10年
        return api_response(False, "续期天数不能超过3650天", code=400)
    
    success, message = await UserService.renew_user(user, days)
    if success:
        # 重新获取用户以获取更新后的到期时间
        updated_user = await UserOperate.get_user_by_uid(user.UID)
        expired_at = updated_user.EXPIRED_AT
        
        import time
        current_time = int(time.time())
        days_left = 0
        if expired_at and expired_at > 0 and expired_at != 253402214400:
            days_left = max(0, (expired_at - current_time) // 86400)
        
        return api_response(True, message, {
            'uid': user.UID,
            'expired_at': expired_at,
            'days_left': days_left if expired_at != 253402214400 else -1,
        })
    return api_response(False, message, code=400)


# ==================== API Key 管理 ====================

@apikey_bp.route('/key/refresh', methods=['POST'])
@require_apikey
async def refresh_apikey():
    """
    刷新 API Key（生成新的 API Key，旧的立即失效）
    
    Headers:
        X-API-Key: <your_current_api_key>
    
    Response:
        {
            "success": true,
            "message": "API Key 已刷新",
            "data": {
                "new_apikey": "key-xxxxxxxxxxxxxxxx-yyyyyyyy",
                "enabled": true
            }
        }
    """
    user = g.current_user
    
    # 生成新的 API Key
    new_apikey = await UserOperate.reset_apikey(user)
    
    return api_response(True, "API Key 已刷新", {
        'new_apikey': new_apikey,
        'enabled': True,
        'warning': '旧的 API Key 已立即失效，请更新所有使用该 Key 的外部系统',
    })


# ==================== 权限管理 ====================

@apikey_bp.route('/permissions', methods=['GET'])
@require_apikey
async def get_permissions():
    """
    获取当前 API Key 的权限列表
    
    Response:
        {
            "success": true,
            "data": {
                "permissions": ["account:read", "account:write", ...],
                "all_permissions": ["account:read", "account:write", "media:read", ...]
            }
        }
    """
    return api_response(True, "获取成功", {
        'permissions': g.apikey_permissions,
        'all_permissions': ALL_PERMISSIONS,
    })


@apikey_bp.route('/permissions', methods=['PUT'])
@require_apikey
async def update_permissions():
    """
    更新 API Key 的权限列表
    
    Request:
        {
            "permissions": ["account:read", "media:read"]
        }
    """
    data = request.get_json() or {}
    permissions = data.get('permissions')
    
    if permissions is None:
        return api_response(False, "缺少 permissions 参数", code=400)
    
    if not isinstance(permissions, list):
        return api_response(False, "permissions 必须是数组", code=400)
    
    # 验证权限值
    invalid = [p for p in permissions if p not in ALL_PERMISSIONS]
    if invalid:
        return api_response(False, f"无效的权限: {', '.join(invalid)}", code=400)
    
    user = g.current_user
    user.APIKEY_PERMISSIONS = json.dumps(permissions)
    await UserOperate.update_user(user)
    
    return api_response(True, "权限已更新", {
        'permissions': permissions,
    })


@apikey_bp.route('/key/disable', methods=['POST'])
@require_apikey
async def disable_apikey():
    """
    禁用当前 API Key
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "API Key 已禁用",
            "data": {
                "uid": 1,
                "enabled": false
            }
        }
    """
    user = g.current_user
    
    await UserOperate.set_apikey_status(user.UID, False)
    
    return api_response(True, "API Key 已禁用", {
        'uid': user.UID,
        'enabled': False,
        'warning': '此 API Key 已禁用，无法再使用此 Key 访问任何接口',
    })


@apikey_bp.route('/key/enable', methods=['POST'])
@require_apikey
async def enable_apikey():
    """
    启用 API Key（如果不存在则生成）
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "API Key 已启用",
            "data": {
                "uid": 1,
                "enabled": true,
                "apikey": "key-xxxxxxxxxxxxxxxx-yyyyyyyy"
            }
        }
    """
    user = g.current_user
    
    # 安全策略：启用时始终旋转新 Key，避免泄露后继续可用
    new_apikey = await UserOperate.reset_apikey(user)
    return api_response(True, "API Key 已生成并启用", {
        'uid': user.UID,
        'enabled': True,
        'apikey': new_apikey,
    })


# ==================== Emby 相关 ====================

@apikey_bp.route('/emby/status', methods=['GET'])
@require_apikey
@require_permission('emby:read')
async def get_emby_status():
    """
    获取 Emby 账号状态
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "获取成功",
            "data": {
                "emby_id": "xxx",
                "is_synced": true,
                "is_active": true,
                "active_sessions": 2
            }
        }
    """
    user = g.current_user
    
    if not user.EMBYID:
        return api_response(False, "账号未绑定 Emby", code=400)
    
    status = await EmbyService.get_user_status(user)
    
    return api_response(True, "获取成功", {
        'emby_id': user.EMBYID,
        'is_synced': status.is_synced,
        'is_active': status.is_active,
        'active_sessions': status.active_sessions,
        'message': status.message,
    })


@apikey_bp.route('/emby/kick', methods=['POST'])
@require_apikey
@require_permission('emby:write')
async def kick_emby_sessions():
    """
    踢出所有 Emby 会话
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "message": "已踢出 2 个会话",
            "data": {
                "kicked_count": 2
            }
        }
    """
    user = g.current_user
    
    if not user.EMBYID:
        return api_response(False, "账号未绑定 Emby", code=400)
    
    success, kicked = await EmbyService.kick_user_sessions(user)
    
    if success:
        return api_response(True, f"已踢出 {kicked} 个会话", {
            'kicked_count': kicked,
        })
    return api_response(False, "操作失败", code=500)

# ==================== NSFW 库管理 ====================

@apikey_bp.route('/emby/nsfw', methods=['GET'])
@require_apikey
@require_permission('emby:read')
async def get_nsfw_status():
    """
    获取 NSFW 库状态
    
    Headers:
        X-API-Key: <your_api_key>
    
    Response:
        {
            "success": true,
            "data": {
                "enabled": true,
                "has_permission": true,
                "nsfw_library_name": "xxx",
                "can_toggle": true
            }
        }
    """
    user = g.current_user

    nsfw_library_name = EmbyService.get_nsfw_library_name()
    nsfw_library_id = await EmbyService.find_nsfw_library_id()

    if not nsfw_library_id:
        return api_response(True, "NSFW 库未配置", {
            'enabled': False,
            'has_permission': False,
            'nsfw_library_name': None,
            'can_toggle': False,
        })

    return api_response(True, "获取成功", {
        'enabled': user.NSFW,
        'has_permission': bool(user.NSFW_ALLOWED),
        'nsfw_library_name': nsfw_library_name,
        'can_toggle': bool(user.NSFW_ALLOWED),
    })


@apikey_bp.route('/emby/nsfw', methods=['PUT'])
@require_apikey
@require_permission('emby:write')
async def toggle_nsfw():
    """
    切换 NSFW 库访问
    
    Headers:
        X-API-Key: <your_api_key>
    
    Request:
        {
            "enable": true
        }
    
    Response:
        {
            "success": true,
            "message": "NSFW 已开启"
        }
    """
    user = g.current_user
    data = request.get_json() or {}
    enable = data.get('enable', False)

    nsfw_library_id = await EmbyService.find_nsfw_library_id()
    if not nsfw_library_id:
        return api_response(False, "系统未配置 NSFW 媒体库", code=400)

    if not user.NSFW_ALLOWED:
        return api_response(False, "管理员未授予您 NSFW 库的访问权限", code=403)

    success, message = await UserService.toggle_nsfw(user, enable)
    return api_response(success, message)


# ==================== 授权码 ====================

@apikey_bp.route('/use-code', methods=['POST'])
@require_apikey
@require_permission('account:write')
async def use_code():
    """
    使用授权码（注册码/续期码/白名单码）
    
    Headers:
        X-API-Key: <your_api_key>
    
    Request:
        {
            "reg_code": "code-xxx"
        }
    
    Response:
        {
            "success": true,
            "message": "操作成功",
            "data": {
                "emby_password": "xxx",
                "expired_at": 12345678,
                "role": 1,
                "role_name": "普通用户"
            }
        }
    """
    user = g.current_user
    data = request.get_json() or {}
    reg_code = data.get('reg_code', '').strip()

    if not reg_code:
        return api_response(False, "缺少授权码", code=400)

    success, message, emby_password = await UserService.use_code(user, reg_code)

    if success:
        # 重新获取用户信息
        updated_user = await UserOperate.get_user_by_uid(user.UID)
        role_names = {0: 'ADMIN', 1: 'NORMAL', 2: 'WHITE_LIST', -1: 'UNRECOGNIZED'}
        return api_response(True, message, {
            'emby_password': emby_password,
            'expired_at': updated_user.EXPIRED_AT,
            'role': updated_user.ROLE,
            'role_name': role_names.get(updated_user.ROLE, 'UNKNOWN'),
        })
    return api_response(False, message, code=400)

