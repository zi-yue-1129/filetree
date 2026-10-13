from typing import Optional
from fastapi import APIRouter, HTTPException, Depends, Form, Request
from slowapi.util import get_remote_address
from backend.services.user_service import user_service
from backend.services.token_service import token_service
from backend.services.audit_service import AuditService
from backend.schemas import UnlockRequest
from backend.core.rate_limit import limiter, LOGIN_LIMIT
from backend.services.password_lookup import verify_password_async
from backend.core.utils import get_client_ip
from backend.config import settings
import os

router = APIRouter()

# Initialize localized audit service
audit_service = AuditService(os.path.join(settings.paths.user_info_file.parent, "audit_logs.json"))


@router.post("/login")
@limiter.limit(LOGIN_LIMIT)
async def login(request: Request, password: str = Form(...)):
    """Verify password and return the associated user with a session token.

    Args:
        request: Incoming HTTP request (rate-limit and audit identity).
        password: The account password; it alone identifies the user.

    Returns:
        Safe user fields plus a new session token.

    Raises:
        HTTPException: 401 for a wrong password, 429 when rate limited.
    """
    user = await user_service.get_user_by_password(
        password, client_key=get_remote_address(request)
    )
    if not user:
        await audit_service.log_event(
            "system", "LOGIN_FAILURE",
            "Authentication failed for unknown user",
            level="WARNING", ip=get_client_ip(request),
        )
        raise HTTPException(status_code=401, detail="密碼錯誤")

    await audit_service.log_event(
        user["username"], "LOGIN_SUCCESS",
        "User authenticated successfully",
        ip=get_client_ip(request),
    )

    # SECURE: Create a session token instead of sending hashes to frontend
    session_token = token_service.create_session_token(user["username"])

    # Return safe user data
    return {
        "username": user["username"],
        "folder": user["folder"],
        "is_locked": user["is_locked"],
        "first_login": user["first_login"],
        "data_retention_days": user.get("data_retention_days"),
        "show_in_list": user["show_in_list"],
        "token": session_token, # New persistent token
        "folders": user.get("folders", []),
    }


@router.post("/user/{username}/unlock")
@limiter.limit(LOGIN_LIMIT)
async def unlock_user(request: Request, username: str, password: str = Form(None)):
    """Verify password for unlocking the dashboard and return a session token.

    Args:
        request: Incoming HTTP request (rate-limit identity).
        username: Account whose dashboard is being unlocked.
        password: That account's password.

    Returns:
        Safe user fields plus a new session token.

    Raises:
        HTTPException: 422 without a password, 404 for an unknown user,
            401 for a wrong password, 429 when rate limited.
    """
    if not password:
        raise HTTPException(status_code=422, detail="Password is required")

    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    if not await verify_password_async(password, user["salt"], user["hashed_password"]):
        raise HTTPException(status_code=401, detail="密碼驗證失敗")

    # SECURE: Transition to session token
    token = token_service.create_session_token(username)

    return {
        "username": user["username"],
        "folder": user["folder"],
        "is_locked": user["is_locked"],
        "first_login": user["first_login"],
        "data_retention_days": user.get("data_retention_days"),
        "show_in_list": user["show_in_list"],
        "token": token,
        "folders": user.get("folders", []),
    }
