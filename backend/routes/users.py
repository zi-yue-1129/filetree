"""User dashboard and owner profile management routes."""

import os
from typing import Any, Optional

from fastapi import APIRouter, Form, Header, HTTPException, Request

from backend.config import settings
from backend.core.auth import extract_bearer_token, verify_password
from backend.core.utils import get_client_ip
from backend.services.audit_service import AuditService
from backend.services.event_service import event_service
from backend.services.file_service import file_service
from backend.services.note_service import note_service
from backend.services.token_service import token_service
from backend.services.user_service import user_service

router = APIRouter()
audit_service = AuditService(
    os.path.join(settings.paths.user_info_file.parent, "audit_logs.json")
)


@router.get("/user/{username}")
async def get_user_dashboard(
    request: Request,
    username: str,
    authorization: str = Header(None),
    token: Optional[str] = None,
) -> Any:
    """Get dashboard data for a user.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        authorization: Optional Bearer authorization header.
        token: Caller credential or scoped file capability, where supported.

    Returns:
        Endpoint response.
    """
    # Support both Header and Query for flexibility
    session_token = token
    if authorization and authorization.startswith("Bearer "):
        session_token = extract_bearer_token(authorization)

    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Check authentication state via token
    is_authenticated = False
    if await token_service.resolves_owner(session_token, username):
        is_authenticated = True

    # Get folders with visibility logic (hides locked folders + descendants if unauth)
    visible_folders, hidden_folder_ids = (
        await user_service.get_visible_folders_and_hidden_ids(
            user["id"], is_authenticated
        )
    )

    # Files from files.db (exclude those in hidden folders)
    all_files = await file_service.get_user_files(
        user["folder"],
        user.get("data_retention_days"),
        excluded_folder_ids=hidden_folder_ids,
        include_locked=is_authenticated,
    )

    # URLs from notes.db (exclude those in hidden folders)
    urls = await note_service.get_urls(
        username, excluded_folder_ids=hidden_folder_ids, include_locked=is_authenticated
    )

    return {
        "user": {
            "username": user["username"],
            "show_in_list": user["show_in_list"],
            "first_login": user["first_login"],
            "is_locked": user["is_locked"],
        },
        "usage": round(
            sum(f.get("size_bytes", 0) for f in all_files) / (1024 * 1024), 2
        ),
        "files": all_files,
        "urls": urls,
        "folders": visible_folders,
    }


@router.post("/user/change-password")
async def change_password(
    request: Request,
    username: str = Form(...),
    old_password: str = Form(...),
    new_password: str = Form(...),
) -> Any:
    """Allow a user to change their password.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        old_password: Current account password.
        new_password: Replacement password.

    Returns:
        Endpoint response.
    """
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    if not verify_password(old_password, user["salt"], user["hashed_password"]):
        raise HTTPException(status_code=401, detail="舊密碼錯誤")

    success = await user_service.reset_password(username, new_password)
    if success:
        await user_service.update_user(username, {"first_login": False})
        await audit_service.log_event(
            username,
            "CHANGE_PASSWORD_SUCCESS",
            "User changed password successfully",
            level="INFO",
            ip=get_client_ip(request),
        )
        await event_service.notify_user_update(username)
        return {"message": "密碼更新成功", "status": "success"}

    raise HTTPException(status_code=500, detail="密碼更新失敗")


@router.post("/user/update-profile")
async def update_own_profile(
    request: Request,
    username: str = Form(...),
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    authorization: str = Header(None),
    show_in_list: bool = Form(...),
) -> Any:
    """User endpoint to update their own profile settings.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.
        show_in_list: Whether to display the account in the public list.

    Returns:
        Endpoint response.
    """
    # Support both Header and Form for flexibility
    session_token = token
    if authorization and authorization.startswith("Bearer "):
        session_token = extract_bearer_token(authorization)

    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(session_token, username):
        auth_success = True
    elif password:
        if verify_password(password, user["salt"], user["hashed_password"]):
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    await user_service.update_user(username, {"show_in_list": show_in_list})

    await audit_service.log_event(
        username,
        "PROFILE_UPDATE",
        f"User updated profile visibility to {show_in_list}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(username)
    await event_service.notify_global_update("USER_LIST_UPDATE")
    return {"message": "設定更新成功", "status": "success"}


@router.post("/user/{username}/toggle-lock")
async def toggle_item_lock(
    username: str,
    item_id: str = Form(...),
    item_type: str = Form(...),
    is_locked: bool = Form(...),
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    authorization: str = Header(None),
) -> Any:
    """Toggle lock status for a file or URL.

    Args:
        username: Target account username.
        item_id: Item identifier.
        item_type: File, URL, or folder item type.
        is_locked: Requested lock state.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    # Support both Header and Form for flexibility
    session_token = token
    if authorization and authorization.startswith("Bearer "):
        session_token = extract_bearer_token(authorization)

    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(session_token, username):
        auth_success = True
    elif password:
        if verify_password(password, user["salt"], user["hashed_password"]):
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    if item_type == "file":
        success = await file_service.toggle_file_lock(
            user["folder"], item_id, is_locked
        )
    elif item_type == "url":
        success = await note_service.toggle_url_lock(username, item_id, is_locked)
    elif item_type == "folder":
        success = await user_service.toggle_folder_lock(username, item_id, is_locked)
    else:
        raise HTTPException(status_code=400, detail="不支援的類型")

    if not success:
        raise HTTPException(status_code=404, detail="找不到指定項目")

    await event_service.notify_user_update(username)
    return {"status": "success", "message": "鎖定狀態已更新"}
