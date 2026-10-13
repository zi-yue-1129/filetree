"""Persist hashed native credentials and revocable device registrations."""

import hashlib
import secrets
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from backend.services.database import get_users_db


class DeviceService:
    """Manage device records in the shared users database."""

    async def register(
        self,
        user_id: int,
        device_name: str,
        platform: str,
        push_token: Optional[str] = None,
    ) -> tuple[str, str]:
        """Create a registration and return its one-time plaintext credential.

        Args:
            user_id: Account database identifier.
            device_name: User-visible device name.
            platform: Supported native platform.
            push_token: Optional FCM registration token.

        Returns:
            Device ID and freshly generated device token.
        """
        device_id = str(uuid.uuid4())
        token = secrets.token_urlsafe(32)
        now = datetime.now(timezone.utc).isoformat()
        database = await get_users_db()
        await database.execute(
            "INSERT INTO devices (id, user_id, device_name, platform, token_hash, "
            "push_token, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            (
                device_id,
                user_id,
                device_name,
                platform,
                hashlib.sha256(token.encode()).hexdigest(),
                push_token,
                now,
                now,
            ),
        )
        await database.commit()
        return device_id, token

    async def resolve_token(self, token: Optional[str]) -> Optional[dict[str, Any]]:
        """Resolve an active hashed credential and throttle last-seen writes.

        Args:
            token: Raw credential presented by a client.

        Returns:
            Active device metadata with its owning username, or None.
        """
        if not token:
            return None
        database = await get_users_db()
        cursor = await database.execute(
            "SELECT d.*, u.username FROM devices d JOIN users u ON u.id = d.user_id "
            "WHERE d.token_hash = ? AND d.revoked_at IS NULL",
            (hashlib.sha256(token.encode()).hexdigest(),),
        )
        row = await cursor.fetchone()
        if row is None:
            return None
        device = dict(row)
        now = datetime.now(timezone.utc)
        if datetime.fromisoformat(device["last_seen_at"]) <= now - timedelta(minutes=1):
            await database.execute(
                "UPDATE devices SET last_seen_at = ? WHERE id = ? "
                "AND datetime(last_seen_at) <= datetime(?, '-1 minute') "
                "AND revoked_at IS NULL",
                (now.isoformat(), device["id"], now.isoformat()),
            )
            await database.commit()
        return device

    async def get_active(self, device_id: str) -> Optional[dict[str, Any]]:
        """Fetch an active registration for continuation and revocation checks.

        Args:
            device_id: Registration ID.

        Returns:
            Active device and username, or None.
        """
        database = await get_users_db()
        cursor = await database.execute(
            "SELECT d.*, u.username FROM devices d JOIN users u ON u.id = d.user_id "
            "WHERE d.id = ? AND d.revoked_at IS NULL",
            (device_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row is not None else None

    async def list_devices(self, username: str) -> list[dict[str, Any]]:
        """List account registrations without authentication or push secrets.

        Args:
            username: Owning account name.

        Returns:
            Safe device records, including revocation history.
        """
        database = await get_users_db()
        cursor = await database.execute(
            "SELECT d.id, d.device_name, d.platform, d.created_at, d.last_seen_at, "
            "d.revoked_at FROM devices d JOIN users u ON d.user_id = u.id "
            "WHERE u.username = ? ORDER BY d.created_at, d.id",
            (username,),
        )
        return [dict(row) for row in await cursor.fetchall()]

    async def patch(self, device_id: str, fields: dict[str, Any]) -> None:
        """Update explicitly supplied device name or push token fields.

        Args:
            device_id: Authorized registration ID.
            fields: Validated patch fields.
        """
        allowed = {
            key: value
            for key, value in fields.items()
            if key in {"device_name", "push_token"}
        }
        if not allowed:
            return
        database = await get_users_db()
        assignments = ", ".join(f"{key} = ?" for key in allowed)
        await database.execute(
            f"UPDATE devices SET {assignments} WHERE id = ? AND revoked_at IS NULL",
            (*allowed.values(), device_id),
        )
        await database.commit()

    async def revoke(self, device_id: str) -> None:
        """Permanently invalidate a device credential.

        Args:
            device_id: Authorized registration ID.
        """
        database = await get_users_db()
        await database.execute(
            "UPDATE devices SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL",
            (datetime.now(timezone.utc).isoformat(), device_id),
        )
        await database.commit()


device_service = DeviceService()
