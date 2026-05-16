"""跨请求/线程安全的后台任务投递器。

为什么需要这个：
    生产环境用 ``uvicorn asgi:app``，``asgi.app`` 是 ``WsgiToAsgi(flask_app)``。
    asgiref 为**每个请求**临时创建一个 ``CurrentThreadExecutor`` 来桥接 WSGI／
    Flask async view。请求返回时这个 executor 立即被销毁。
    若我们在 handler 中 ``loop.create_task(...)`` 起一个后台协程，handler 返回
    后协程仍在跑，它再去 ``await`` 任何走 ``run_in_executor`` 的东西就会触发::

        RuntimeError: CurrentThreadExecutor already quit or is broken

设计：
    在进程内启动**一个**守护线程，跑一个长生命周期的 asyncio 事件循环。
    需要做"开火后忘"工作的地方调用 ``submit_background(coro)``，工作就被
    ``asyncio.run_coroutine_threadsafe`` 投递到这个独立 loop 上执行，
    完全脱离任何请求的生命周期。
"""
from __future__ import annotations

import asyncio
import logging
import threading
from concurrent.futures import Future
from typing import Coroutine, Optional, Any

logger = logging.getLogger(__name__)

_LOCK = threading.Lock()
_LOOP: Optional[asyncio.AbstractEventLoop] = None
_THREAD: Optional[threading.Thread] = None


def _ensure_loop() -> asyncio.AbstractEventLoop:
    """懒启动后台线程 + 事件循环（线程安全）。"""
    global _LOOP, _THREAD
    if _LOOP is not None and _LOOP.is_running():
        return _LOOP
    with _LOCK:
        if _LOOP is not None and _LOOP.is_running():
            return _LOOP

        loop = asyncio.new_event_loop()
        ready = threading.Event()

        def _runner() -> None:
            asyncio.set_event_loop(loop)
            ready.set()
            try:
                loop.run_forever()
            finally:
                try:
                    pending = asyncio.all_tasks(loop)
                    for t in pending:
                        t.cancel()
                    loop.run_until_complete(loop.shutdown_asyncgens())
                except Exception:
                    pass
                finally:
                    loop.close()

        t = threading.Thread(
            target=_runner,
            name="twilight-background-loop",
            daemon=True,
        )
        t.start()
        ready.wait(timeout=5.0)
        _LOOP = loop
        _THREAD = t
        return loop


def submit_background(coro: Coroutine[Any, Any, Any]) -> "Future[Any]":
    """把协程投递到后台事件循环执行。

    Returns:
        concurrent.futures.Future —— 大多数 fire-and-forget 场景不用关心，
        但需要等结果或捕获异常时仍可拿到。
    """
    if not asyncio.iscoroutine(coro):
        raise TypeError("submit_background 需要一个协程对象（async def func() 的返回值）")

    loop = _ensure_loop()
    future: "Future[Any]" = asyncio.run_coroutine_threadsafe(coro, loop)

    def _log_error(f: "Future[Any]") -> None:
        exc = f.exception()
        if exc is not None:
            logger.warning("后台任务异常: %s", exc, exc_info=exc)

    future.add_done_callback(_log_error)
    return future


def get_background_loop() -> asyncio.AbstractEventLoop:
    """暴露后台 loop，方便需要直接调度的场景（仅在确实需要时使用）。"""
    return _ensure_loop()
