"""
Emby 自由注册队列服务

目标：
1. 在高并发场景下以队列方式处理 Emby 账号创建，避免瞬时冲击后端与 Emby。
2. 对同一 Telegram/用户名进行去重，防止重复提交。
3. 对外返回 request_id + status_token，支持安全轮询查询状态。
"""

import asyncio
import logging
import secrets
import time
from dataclasses import dataclass
from typing import Any, Dict, Optional

from src.config import Config, RegisterConfig
from src.db.user import UserOperate
from src.services.user_service import RegisterResult, UserService

logger = logging.getLogger(__name__)


@dataclass
class _QueueTask:
    request_id: str
    status_token: str
    telegram_id: int
    username: str
    email: Optional[str]
    password: Optional[str]
    created_at: int


class EmbyRegisterQueueService:
    """Emby 注册请求队列。"""

    _queue: Optional[asyncio.Queue[_QueueTask]] = None
    _workers: list[asyncio.Task] = []
    _started: bool = False

    _start_lock = asyncio.Lock()
    _state_lock = asyncio.Lock()

    _status: Dict[str, Dict[str, Any]] = {}
    _pending_by_tg: Dict[int, str] = {}
    _pending_by_username: Dict[str, str] = {}

    @classmethod
    def _now(cls) -> int:
        return int(time.time())

    @classmethod
    def _status_ttl(cls) -> int:
        return max(60, int(RegisterConfig.EMBY_DIRECT_REGISTER_STATUS_TTL or 1800))

    @classmethod
    def _worker_count(cls) -> int:
        configured = int(RegisterConfig.EMBY_DIRECT_REGISTER_WORKERS or 8)
        return min(max(configured, 1), 32)

    @classmethod
    def _queue_max_size(cls) -> int:
        configured = int(RegisterConfig.EMBY_DIRECT_REGISTER_MAX_QUEUE or 1000)
        return min(max(configured, 10), 10000)

    @classmethod
    async def ensure_started(cls) -> None:
        """按需启动队列 worker。"""
        if cls._started:
            return

        async with cls._start_lock:
            if cls._started:
                return

            cls._queue = asyncio.Queue(maxsize=cls._queue_max_size())
            worker_count = cls._worker_count()
            cls._workers = [
                asyncio.create_task(cls._worker_loop(i + 1), name=f"emby-register-worker-{i + 1}")
                for i in range(worker_count)
            ]
            cls._started = True
            logger.info("Emby 注册队列已启动，workers=%s, max_queue=%s", worker_count, cls._queue_max_size())

    @classmethod
    async def _cleanup_expired_status_locked(cls) -> None:
        """清理过期状态，防止内存持续增长。"""
        now = cls._now()
        ttl = cls._status_ttl()
        to_delete: list[str] = []

        for request_id, item in cls._status.items():
            status = item.get("status")
            updated_at = int(item.get("updated_at") or 0)
            if status in ("success", "failed", "rejected") and (now - updated_at) > ttl:
                to_delete.append(request_id)

        for request_id in to_delete:
            cls._status.pop(request_id, None)

    @classmethod
    def _queue_position_unlocked(cls, request_id: str) -> Optional[int]:
        if cls._queue is None:
            return None
        queue_items = list(cls._queue._queue)  # noqa: SLF001 - 仅用于状态展示
        for idx, task in enumerate(queue_items, start=1):
            if task.request_id == request_id:
                return idx
        return None

    @classmethod
    async def enqueue(
        cls,
        telegram_id: int,
        username: str,
        email: Optional[str] = None,
        password: Optional[str] = None,
    ) -> tuple[Optional[Dict[str, Any]], str]:
        """提交 Emby 注册请求。"""
        if not RegisterConfig.EMBY_DIRECT_REGISTER_ENABLED:
            return None, "Emby 自由注册未开启"

        await cls.ensure_started()

        if cls._queue is None:
            return None, "注册队列尚未就绪"

        username_key = username.lower()

        # 先做一次无锁快速检查，降低高并发下全局状态锁竞争。
        current_count = await UserService.get_registered_user_count()
        existing_tg = await UserOperate.get_user_by_telegram_id(telegram_id)
        if existing_tg and existing_tg.EMBYID:
            return None, "该 Telegram 账号已绑定 Emby 账户"

        existing_name = await UserOperate.get_user_by_username(username)
        if existing_name and existing_name.EMBYID:
            return None, "该用户名已被占用"
        if existing_name and existing_name.TELEGRAM_ID and existing_name.TELEGRAM_ID != telegram_id:
            return None, "该用户名已被占用"

        async with cls._state_lock:
            await cls._cleanup_expired_status_locked()

            # 去重：同一 Telegram/用户名已有排队或处理中任务时直接复用
            existing_request_id = cls._pending_by_tg.get(telegram_id) or cls._pending_by_username.get(username_key)
            if existing_request_id:
                item = cls._status.get(existing_request_id)
                if item:
                    return {
                        "request_id": existing_request_id,
                        "status_token": item.get("status_token"),
                        "status": item.get("status"),
                        "queue_position": cls._queue_position_unlocked(existing_request_id),
                        "reused": True,
                    }, "该账号已有注册请求正在处理中"

            # 快速限流：队列过长直接拒绝，避免内存暴涨
            if cls._queue.qsize() >= cls._queue.maxsize:
                return None, "注册请求过多，请稍后再试"

            # 快速容量检查：已注册人数 + 排队中人数不超过上限
            pending_count = len(cls._pending_by_username)
            if current_count + pending_count >= RegisterConfig.USER_LIMIT:
                return None, f"已达到用户数量上限 ({RegisterConfig.USER_LIMIT})"

            request_id = f"erq_{secrets.token_hex(8)}"
            status_token = secrets.token_urlsafe(20)
            now = cls._now()
            queue_position = cls._queue.qsize() + 1
            task = _QueueTask(
                request_id=request_id,
                status_token=status_token,
                telegram_id=telegram_id,
                username=username,
                email=email,
                password=password,
                created_at=now,
            )

            cls._pending_by_tg[telegram_id] = request_id
            cls._pending_by_username[username_key] = request_id
            cls._status[request_id] = {
                "request_id": request_id,
                "status_token": status_token,
                "status": "queued",
                "created_at": now,
                "updated_at": now,
                "telegram_id": telegram_id,
                "username": username,
                "message": "已进入注册队列，等待处理",
                "queue_position": queue_position,
            }

            cls._queue.put_nowait(task)

            return {
                "request_id": request_id,
                "status_token": status_token,
                "status": "queued",
                "queue_position": queue_position,
                "reused": False,
            }, "已加入 Emby 注册队列"

    @classmethod
    async def get_status(cls, request_id: str, status_token: str) -> Optional[Dict[str, Any]]:
        """获取注册任务状态。"""
        async with cls._state_lock:
            await cls._cleanup_expired_status_locked()
            item = cls._status.get(request_id)
            if not item:
                return None
            if item.get("status_token") != status_token:
                return None

            result = dict(item)
            result.pop("status_token", None)
            if result.get("status") == "queued":
                result["queue_position"] = cls._queue_position_unlocked(request_id)
            return result

    @classmethod
    async def _worker_loop(cls, worker_id: int) -> None:
        assert cls._queue is not None

        while True:
            task = await cls._queue.get()
            try:
                await cls._mark_processing(task)
                result = await UserService.register_direct_emby(
                    telegram_id=task.telegram_id,
                    username=task.username,
                    email=task.email,
                    password=task.password,
                )

                if result.result == RegisterResult.SUCCESS:
                    await cls._mark_success(task, result)
                else:
                    await cls._mark_failed(task, result.message)
            except Exception as exc:  # pragma: no cover
                logger.error("Emby 注册队列 worker=%s 处理失败: %s", worker_id, exc, exc_info=True)
                await cls._mark_failed(task, "创建 Emby 账户失败，请稍后重试")
            finally:
                cls._queue.task_done()

    @classmethod
    async def _mark_processing(cls, task: _QueueTask) -> None:
        async with cls._state_lock:
            item = cls._status.get(task.request_id)
            if not item:
                return
            item["status"] = "processing"
            item["updated_at"] = cls._now()
            item["message"] = "正在向 Emby 创建账号"
            item["queue_position"] = None

    @classmethod
    async def _mark_success(cls, task: _QueueTask, result: Any) -> None:
        async with cls._state_lock:
            now = cls._now()
            item = cls._status.get(task.request_id)
            if not item:
                return

            item["status"] = "success"
            item["updated_at"] = now
            item["finished_at"] = now
            item["message"] = result.message
            item["queue_position"] = None
            item["data"] = {
                "uid": result.user.UID if result.user else None,
                "username": result.user.USERNAME if result.user else task.username,
                "emby_password": result.emby_password,
            }

            cls._pending_by_tg.pop(task.telegram_id, None)
            cls._pending_by_username.pop(task.username.lower(), None)

    @classmethod
    async def _mark_failed(cls, task: _QueueTask, message: str) -> None:
        async with cls._state_lock:
            now = cls._now()
            item = cls._status.get(task.request_id)
            if not item:
                return

            item["status"] = "failed"
            item["updated_at"] = now
            item["finished_at"] = now
            item["message"] = message
            item["queue_position"] = None

            cls._pending_by_tg.pop(task.telegram_id, None)
            cls._pending_by_username.pop(task.username.lower(), None)
