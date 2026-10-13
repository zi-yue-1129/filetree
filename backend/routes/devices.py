"""Password-authenticated native registration and owner-scoped management."""

import os
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field, ValidationError, field_validator
from slowapi.util import get_remote_address

from backend.config import settings
from backend.core.auth import get_current_user_token
from backend.core.rate_limit import LOGIN_LIMIT, limiter
from backend.core.utils import get_client_ip
from backend.services.audit_service import AuditService
from backend.services.device_service import device_service
from backend.services.event_service import event_service
from backend.services.token_service import token_service
from backend.services.upload_folder_service import ensure_folder_path
from backend.services.user_service import user_service

router = APIRouter()
audit_service = AuditService(
    os.path.join(settings.paths.user_info_file.parent, "audit_logs.json")
)


class DeviceRegistration(BaseModel):
    """Validated native login and device registration payload."""

    password: str
    device_name: str = Field(min_length=1, max_length=255)
    platform: Literal["android", "ios", "windows", "macos"]
    push_token: Optional[str] = Field(default=None, max_length=4096)

    @field_validator("device_name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        """Reject blank device names.

        Args:
            value: Device display name.

        Returns:
            Trimmed display name.

        Raises:
            ValueError: For a blank or null-containing name.
        """
        if not value.strip() or "\x00" in value:
            raise ValueError("Invalid device name")
        return value.strip()


class DevicePatch(BaseModel):
    """Explicitly supplied mutable device properties."""

    device_name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    push_token: Optional[str] = Field(default=None, max_length=4096)

    @field_validator("device_name")
    @classmethod
    def validate_name(cls, value: Optional[str]) -> str:
        """Validate an explicitly provided device name.

        Args:
            value: New display name.

        Returns:
            Trimmed display name.
        """
        if value is None:
            raise ValueError("Device name cannot be null")
        return DeviceRegistration.validate_name(value)


class BackupFolderRequest(BaseModel):
    """Named device backup destination request."""

    device_name: str = Field(min_length=1, max_length=255)


@router.post("/devices/register")
@limiter.limit(LOGIN_LIMIT)
async def register_device(request: Request) -> dict[str, str]:
    """Authenticate by password and issue a persisted revocable credential.

    Args:
        request: JSON or form registration request.

    Returns:
        Registration ID, plaintext credential, and owner username.
    """
    try:
        if request.headers.get("content-type", "").split(";")[0] == "application/json":
            fields = await request.json()
        else:
            fields = dict(await request.form())
        payload = DeviceRegistration.model_validate(fields)
    except (ValidationError, ValueError) as error:
        raise HTTPException(
            status_code=422, detail="Invalid device registration"
        ) from error
    user = await user_service.get_user_by_password(
        payload.password, client_key=get_remote_address(request)
    )
    if user is None:
        await audit_service.log_event(
            "system",
            "DEVICE_REGISTER_FAILURE",
            "Device password authentication failed",
            level="WARNING",
            ip=get_client_ip(request),
        )
        raise HTTPException(status_code=401, detail="Invalid password")
    device_id, token = await device_service.register(
        user["id"], payload.device_name, payload.platform, payload.push_token
    )
    await audit_service.log_event(
        user["username"],
        "DEVICE_REGISTER",
        f"Registered {payload.platform} device {device_id}",
        ip=get_client_ip(request),
    )
    return {"device_id": device_id, "device_token": token, "username": user["username"]}


@router.get("/devices")
async def list_devices(
    token: str = Depends(get_current_user_token),
) -> list[dict[str, Any]]:
    """List only the authenticated owner's secret-free device records.

    Args:
        token: Owner bearer credential.

    Returns:
        Safe device records.
    """
    username = await token_service.resolve_owner_username(token)
    if username is None:
        raise HTTPException(status_code=401, detail="Invalid owner token")
    return await device_service.list_devices(username)


@router.patch("/devices/{device_id}")
async def patch_device(
    device_id: str, payload: DevicePatch, token: str = Depends(get_current_user_token)
) -> dict[str, bool]:
    """Permit a device credential to edit its own registration.

    Args:
        device_id: Target registration.
        payload: Mutable device fields.
        token: Bearer device credential.

    Returns:
        Success acknowledgement.
    """
    device = await device_service.resolve_token(token)
    if device is None or device["id"] != device_id:
        raise HTTPException(
            status_code=403, detail="Only this device can update its registration"
        )
    await device_service.patch(device_id, payload.model_dump(exclude_unset=True))
    return {"ok": True}


@router.delete("/devices/{device_id}")
async def delete_device(
    device_id: str, token: str = Depends(get_current_user_token)
) -> dict[str, bool]:
    """Revoke a registration using its credential or its owner's session.

    Args:
        device_id: Registration to revoke.
        token: Device or owner session/access credential.

    Returns:
        Success acknowledgement.
    """
    device = await device_service.resolve_token(token)
    target = await device_service.get_active(device_id)
    if target is None:
        raise HTTPException(status_code=404, detail="Active device not found")
    if device is not None:
        allowed = device["id"] == device_id
    else:
        allowed = await token_service.resolves_owner(token, target["username"])
    if not allowed:
        raise HTTPException(status_code=403, detail="Cannot revoke this device")
    await device_service.revoke(device_id)
    return {"ok": True}


@router.post("/backup/folder")
async def backup_folder(
    payload: BackupFolderRequest, token: str = Depends(get_current_user_token)
) -> dict[str, str]:
    """Find or create the authenticated device's album backup folder.

    Args:
        payload: Device folder name.
        token: Device bearer credential.

    Returns:
        Reusable child folder ID.
    """
    device = await device_service.resolve_token(token)
    if device is None:
        raise HTTPException(status_code=403, detail="Device token required")
    folder_id = await ensure_folder_path(
        device["username"], ["相簿備份", payload.device_name]
    )
    await event_service.notify_user_update(device["username"])
    return {"folder_id": folder_id}
