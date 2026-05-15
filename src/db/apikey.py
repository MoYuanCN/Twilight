"""
多 API Key 数据库模块

每个用户可拥有多个独立 API Key，每个 Key 有独立的名称、权限范围、速率限制、
启用状态、过期时间、调用计数。Key 明文仅在创建时返回一次，DB 仅保存 SHA-256 哈希。
"""
import hashlib
import json
import secrets
import time
from typing import Optional, List, Tuple

from sqlalchemy import (
    select, update, delete, func, String, Integer, Boolean,
)
from sqlalchemy.ext.asyncio import AsyncAttrs
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column

from src.db.utils import init_async_db


class ApiKeysDatabaseModel(AsyncAttrs, DeclarativeBase):
    pass


class ApiKeyModel(ApiKeysDatabaseModel):
    __tablename__ = 'api_keys'

    ID: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    UID: Mapped[int] = mapped_column(Integer, index=True, nullable=False)
    NAME: Mapped[Optional[str]] = mapped_column(String, default='', nullable=True)
    KEY_HASH: Mapped[str] = mapped_column(String(64), index=True, unique=True, nullable=False)
    KEY_PREFIX: Mapped[str] = mapped_column(String(16), default='', nullable=False)
    KEY_SUFFIX: Mapped[str] = mapped_column(String(16), default='', nullable=False)
    ENABLED: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    ALLOW_QUERY: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    PERMISSIONS: Mapped[Optional[str]] = mapped_column(String, default='', nullable=True)  # JSON list
    RATE_LIMIT: Mapped[int] = mapped_column(Integer, default=100, nullable=False)
    REQUEST_COUNT: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    LAST_USED_AT: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    CREATED_AT: Mapped[int] = mapped_column(Integer, default=lambda: int(time.time()), nullable=False)
    EXPIRED_AT: Mapped[int] = mapped_column(Integer, default=-1, nullable=False)


_, ApiKeysSessionFactory = init_async_db("api_keys", ApiKeysDatabaseModel)


def _hash_key(key: str) -> str:
    return hashlib.sha256(key.encode('utf-8')).hexdigest()


def _generate_key() -> str:
    return f"key-{secrets.token_hex(24)}"


class ApiKeyOperate:
    @staticmethod
    async def get_user_api_keys(uid: int) -> List[ApiKeyModel]:
        async with ApiKeysSessionFactory() as session:
            result = await session.execute(
                select(ApiKeyModel)
                .where(ApiKeyModel.UID == uid)
                .order_by(ApiKeyModel.CREATED_AT.desc())
            )
            return list(result.scalars().all())

    @staticmethod
    async def get_api_key_by_id(key_id: int) -> Optional[ApiKeyModel]:
        async with ApiKeysSessionFactory() as session:
            scalar = await session.execute(
                select(ApiKeyModel).where(ApiKeyModel.ID == key_id).limit(1)
            )
            return scalar.scalar_one_or_none()

    @staticmethod
    async def get_api_key_by_plaintext(key: str) -> Optional[ApiKeyModel]:
        key_hash = _hash_key(key)
        async with ApiKeysSessionFactory() as session:
            scalar = await session.execute(
                select(ApiKeyModel).where(ApiKeyModel.KEY_HASH == key_hash).limit(1)
            )
            return scalar.scalar_one_or_none()

    @staticmethod
    async def create_api_key(
        uid: int,
        name: Optional[str] = None,
        allow_query: bool = True,
        rate_limit: int = 100,
        expired_at: int = -1,
        permissions: Optional[List[str]] = None,
    ) -> Tuple[ApiKeyModel, str]:
        """创建新 API Key。返回 (model, plaintext_key) — 明文只在此处返回一次。"""
        plaintext = _generate_key()
        key_hash = _hash_key(plaintext)
        prefix = plaintext[:12]   # "key-xxxxxxxx"
        suffix = plaintext[-8:]
        perms_json = json.dumps(permissions) if permissions is not None else ''

        item = ApiKeyModel(
            UID=uid,
            NAME=(name or '').strip() or f"API Key {int(time.time())}",
            KEY_HASH=key_hash,
            KEY_PREFIX=prefix,
            KEY_SUFFIX=suffix,
            ENABLED=True,
            ALLOW_QUERY=bool(allow_query),
            PERMISSIONS=perms_json,
            RATE_LIMIT=max(0, int(rate_limit)),
            EXPIRED_AT=int(expired_at),
            CREATED_AT=int(time.time()),
        )

        async with ApiKeysSessionFactory() as session:
            async with session.begin():
                session.add(item)
                await session.flush()
                # 返回纯数据快照，避免会话关闭后访问导致 DetachedInstanceError
                snapshot = ApiKeyModel(
                    ID=item.ID,
                    UID=item.UID,
                    NAME=item.NAME,
                    KEY_HASH=item.KEY_HASH,
                    KEY_PREFIX=item.KEY_PREFIX,
                    KEY_SUFFIX=item.KEY_SUFFIX,
                    ENABLED=item.ENABLED,
                    ALLOW_QUERY=item.ALLOW_QUERY,
                    PERMISSIONS=item.PERMISSIONS,
                    RATE_LIMIT=item.RATE_LIMIT,
                    REQUEST_COUNT=item.REQUEST_COUNT,
                    LAST_USED_AT=item.LAST_USED_AT,
                    CREATED_AT=item.CREATED_AT,
                    EXPIRED_AT=item.EXPIRED_AT,
                )
        return snapshot, plaintext

    @staticmethod
    async def update_api_key(
        key_id: int,
        name: Optional[str] = None,
        enabled: Optional[bool] = None,
        allow_query: Optional[bool] = None,
        rate_limit: Optional[int] = None,
        expired_at: Optional[int] = None,
        permissions: Optional[List[str]] = None,
    ) -> Optional[ApiKeyModel]:
        values = {}
        if name is not None:
            values['NAME'] = name.strip()
        if enabled is not None:
            values['ENABLED'] = bool(enabled)
        if allow_query is not None:
            values['ALLOW_QUERY'] = bool(allow_query)
        if rate_limit is not None:
            values['RATE_LIMIT'] = max(0, int(rate_limit))
        if expired_at is not None:
            values['EXPIRED_AT'] = int(expired_at)
        if permissions is not None:
            values['PERMISSIONS'] = json.dumps(permissions)

        if not values:
            return await ApiKeyOperate.get_api_key_by_id(key_id)

        async with ApiKeysSessionFactory() as session:
            async with session.begin():
                await session.execute(
                    update(ApiKeyModel)
                    .where(ApiKeyModel.ID == key_id)
                    .values(**values)
                )

        return await ApiKeyOperate.get_api_key_by_id(key_id)

    @staticmethod
    async def delete_api_key(key_id: int) -> bool:
        async with ApiKeysSessionFactory() as session:
            async with session.begin():
                result = await session.execute(
                    delete(ApiKeyModel).where(ApiKeyModel.ID == key_id)
                )
                return result.rowcount > 0

    @staticmethod
    async def delete_user_keys(uid: int) -> int:
        async with ApiKeysSessionFactory() as session:
            async with session.begin():
                result = await session.execute(
                    delete(ApiKeyModel).where(ApiKeyModel.UID == uid)
                )
                return result.rowcount or 0

    @staticmethod
    async def touch_usage(key_id: int) -> None:
        async with ApiKeysSessionFactory() as session:
            async with session.begin():
                await session.execute(
                    update(ApiKeyModel)
                    .where(ApiKeyModel.ID == key_id)
                    .values(
                        REQUEST_COUNT=ApiKeyModel.REQUEST_COUNT + 1,
                        LAST_USED_AT=int(time.time()),
                    )
                )

    @staticmethod
    def get_permissions(model: ApiKeyModel) -> List[str]:
        if not model.PERMISSIONS:
            return []
        try:
            data = json.loads(model.PERMISSIONS)
            return data if isinstance(data, list) else []
        except (json.JSONDecodeError, TypeError):
            return []
