"""Owner-scoped file, folder, upload, and share API routes."""

import os
from pathlib import Path
from typing import Any, List, Optional

from fastapi import (
    APIRouter,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    UploadFile,
)
from fastapi.responses import FileResponse, Response
from starlette.concurrency import run_in_threadpool
from starlette.background import BackgroundTask

from backend.config import settings
from backend.core.auth import (
    extract_bearer_token,
)
from backend.core.rate_limit import TUS_LIMIT, UPLOAD_LIMIT, limiter
from backend.core.utils import get_client_ip
from backend.schemas import BatchActionRequest, FileInfo, ShareInfo
from backend.services.audit_service import AuditService
from backend.services.archive_service import create_archive
from backend.services.device_service import device_service
from backend.services.event_service import event_service
from backend.services.file_service import file_service
from backend.services.note_service import note_service
from backend.services.push_service import push_service
from backend.services.thumbnail_service import thumbnail_service
from backend.services.token_service import token_service
from backend.services.upload_folder_service import validate_folder
from backend.services.user_service import user_service

router = APIRouter()
audit_service = AuditService(
    os.path.join(settings.paths.user_info_file.parent, "audit_logs.json")
)


async def _resolve_content_path(
    user: dict[str, Any], username: str, filename: str
) -> tuple[Path, bool]:
    """Resolve placement and effective locks with one query at any folder depth.

    Args:
        user: Account with its already-loaded folder tree.
        username: Account username, distinct from its physical storage name.
        filename: Requested file name.

    Returns:
        Physical path and effective user/file/folder lock state.
    """
    folders_by_id = {folder["id"]: folder for folder in user["folders"]}
    records = await file_service.get_file_access_records(
        user["folder"], username, [filename], folders_by_id
    )
    record = records.get(filename)
    folder_id = record.folder_id if record else None
    path_names = user_service.folder_path_names_from_map(folders_by_id, folder_id)
    file_path = file_service.upload_base / user["folder"] / Path(*path_names) / filename
    is_locked = user["is_locked"] or (record.is_locked if record else False)
    return file_path, is_locked


@router.get("/files/{username}", response_model=List[FileInfo])
async def get_files(
    username: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
) -> Any:
    """List files for a specific user.

    Args:
        username: Target account username.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    is_authenticated = await token_service.resolves_owner(token, username)

    # Access control: If user is locked, require a valid owner token
    if user["is_locked"]:
        if not token:
            raise HTTPException(status_code=401, detail="此目錄已鎖定，請先解鎖")
        if not is_authenticated:
            raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    # Same visibility rule as the dashboard: anonymous callers do not see locked
    # files or anything inside a locked folder (or its descendants).
    _, hidden_folder_ids = await user_service.get_visible_folders_and_hidden_ids(
        user["id"], is_authenticated
    )
    return await file_service.get_user_files(
        user["folder"],
        retention_days=user.get("data_retention_days"),
        excluded_folder_ids=hidden_folder_ids,
        include_locked=is_authenticated,
    )


@router.post("/upload")
@limiter.limit(UPLOAD_LIMIT)
async def upload_files(
    request: Request,
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    folder_id: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Handle multiple file uploads into a specific folder.

    Args:
        request: Incoming HTTP request.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        files: Uploaded file streams.
        folder_id: Target folder identifier.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = None
    if password:
        user = await user_service.get_user_by_password(password)
    elif token:
        owner = await token_service.resolve_owner_username(token)
        if owner:
            user = await user_service.get_user_by_name(owner)

    if not user:
        raise HTTPException(status_code=401, detail="驗證失敗，請重新登入或驗證密碼")

    await validate_folder(user["username"], folder_id)

    # Resolve physical path from folder_id
    path = await user_service.get_folder_path_names(user["username"], folder_id)

    uploaded = []
    for file in files:
        if not file.filename:
            continue
        content = await file.read()
        unique_name = await file_service.save_file(
            user["folder"], file.filename, content, path, folder_id
        )
        uploaded.append(unique_name)

    await audit_service.log_event(
        user["username"],
        "FILE_UPLOAD",
        f"Uploaded {len(uploaded)} files: {', '.join(uploaded)}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(user["username"])
    device = await device_service.resolve_token(token)
    push_service.schedule_files_added(
        user["username"], device["id"] if device else None, count=len(uploaded)
    )

    return {
        "message": "檔案上傳成功",
        "uploaded_files": uploaded,
        "redirect": f"/{user['username']}",
        "first_login": user["first_login"],
    }


@router.post("/upload_url")
async def upload_url(
    request: Request,
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    url: str = Form(...),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Handle URL submission.

    Args:
        request: Incoming HTTP request.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        url: URL to save.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = None
    if password:
        user = await user_service.get_user_by_password(password)
    elif token:
        owner = await token_service.resolve_owner_username(token)
        if owner:
            user = await user_service.get_user_by_name(owner)

    if not user:
        raise HTTPException(status_code=401, detail="驗證失敗")

    await note_service.add_url(user["username"], url)

    await audit_service.log_event(
        user["username"],
        "NOTE_CREATE",
        f"Created a secure note/link: {url}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(user["username"])

    return {
        "message": "連結建立成功",
        "redirect": f"/{user['username']}",
        "first_login": user["first_login"],
    }


@router.post("/user/{username}/delete")
async def delete_file(
    request: Request,
    username: str,
    filename: str = Form(...),
    token: Optional[str] = Form(None),
    password: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Delete a file from user's folder.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        filename: Target file name.
        token: Caller credential or scoped file capability, where supported.
        password: Optional account password.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(token, username):
        auth_success = True

    if not auth_success and password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    # Check file lock: locked files MUST have auth
    is_file_locked = await file_service.is_file_locked(user["folder"], filename)
    if is_file_locked or user["is_locked"]:
        if not auth_success:
            raise HTTPException(status_code=403, detail="權限不足或需要驗證")

    # Mutation always requires auth in a secure system (even if not strictly locked)
    if not auth_success:
        raise HTTPException(status_code=401, detail="操作需要驗證")

    # Resolve physical path via files.db folder_id
    from backend.services.database import get_files_db

    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
        (user["folder"], filename),
    )
    row = await cursor.fetchone()
    folder_id = row["folder_id"] if row else None
    path = await user_service.get_folder_path_names(username, folder_id)

    success = await file_service.delete_file(user["folder"], filename, path)
    if not success:
        raise HTTPException(status_code=404, detail="檔案不存在")

    await audit_service.log_event(
        username,
        "FILE_DELETE",
        f"Deleted file: {filename}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(username)
    return {"message": "檔案已刪除"}


@router.post("/user/{username}/rename-file")
async def rename_file(
    request: Request,
    username: str,
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    old_name: str = Form(...),
    new_name: str = Form(...),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Rename a file.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        old_name: Existing file name.
        new_name: New file name.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(token, username):
        auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    if await file_service.is_file_locked(user["folder"], old_name):
        # We already checked auth above, so we can proceed if auth_success is True
        pass

    # Resolve path from files.db
    from backend.services.database import get_files_db

    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
        (user["folder"], old_name),
    )
    row = await cursor.fetchone()
    folder_id = row["folder_id"] if row else None
    path = await user_service.get_folder_path_names(username, folder_id)

    success = await file_service.rename_file(user["folder"], old_name, new_name, path)
    if not success:
        raise HTTPException(
            status_code=400, detail="重新命名失敗（檔案不存在或名稱重複）"
        )

    await audit_service.log_event(
        username,
        "FILE_RENAME",
        f"Renamed {old_name} to {new_name}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(username)
    return {"message": "檔案重新命名成功"}


@router.post("/share/{username}/{filename}")
async def create_share(
    username: str,
    filename: str,
    token: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Generate a temporary sharing token for a file.

    Args:
        username: Target account username.
        filename: Target file name.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Check locks
    is_locked = user["is_locked"] or await file_service.is_file_effectively_locked(
        user["folder"], username, filename
    )
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="此資源已被鎖定，請先解鎖")
        if not await token_service.resolves_owner(token, username):
            raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    share_token = token_service.create_token(username, filename)
    return {
        "success": True,
        "token": share_token,
        "expiry_hours": token_service.expiry_hours,
    }


@router.get("/share-info/{token}", response_model=ShareInfo)
async def get_share_info(token: str) -> ShareInfo:
    """Retrieve info about a shared file.

    Args:
        token: Caller credential or scoped file capability, where supported.

    Returns:
        Endpoint response.
    """
    info = token_service.get_share_token(token)
    if not info:
        raise HTTPException(status_code=404, detail="分享連結已過期或無效")

    user = await user_service.get_user_by_name(info.username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Resolve physical path from files.db
    from backend.services.database import get_files_db

    db = await get_files_db()
    cursor = await db.execute(
        "SELECT size_bytes FROM files WHERE username = ? AND filename = ?",
        (user["folder"], info.filename),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="檔案不存在")
    is_locked = await file_service.is_file_effectively_locked(
        user["folder"], info.username, info.filename
    )

    size_bytes = row["size_bytes"]
    size_mb = round(size_bytes / (1024 * 1024), 2)
    size_str = f"{size_mb} MB" if size_mb >= 0.1 else f"{round(size_bytes/1024, 2)} KB"

    preview_url = (
        f"/api/download/{info.username}/{info.filename}?token={token}&inline=true"
    )
    download_url = f"/api/download-shared/{token}"
    thumbnail_url = f"/api/thumbnail/{info.username}/{info.filename}?token={token}"

    return ShareInfo(
        username=info.username,
        filename=info.filename,
        size=size_str,
        size_bytes=size_bytes,
        expiry=info.expiry,
        is_locked=is_locked,
        preview_url=preview_url,
        download_url=download_url,
        thumbnail_url=thumbnail_url,
    )


@router.get("/download-shared/{token}")
async def download_shared(token: str) -> FileResponse:
    """Download a file via a share token.

    Args:
        token: Caller credential or scoped file capability, where supported.

    Returns:
        Endpoint response.
    """
    info = token_service.get_share_token(token)
    if not info:
        raise HTTPException(status_code=404, detail="分享連結已過期或無效")

    user = await user_service.get_user_by_name(info.username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Resolve physical path from files.db
    from backend.services.database import get_files_db

    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
        (user["folder"], info.filename),
    )
    row = await cursor.fetchone()
    folder_id = row["folder_id"] if row else None
    path_names = await user_service.get_folder_path_names(info.username, folder_id)
    folder = file_service._get_folder_path(user["folder"], path_names)

    return FileResponse(
        path=folder / info.filename,
        filename=info.filename,
        headers={
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
        },
    )


@router.get("/download/{username}/{filename}")
async def download_direct(
    username: str,
    filename: str,
    token: Optional[str] = None,
    inline: Optional[bool] = None,
    authorization: Optional[str] = Header(None),
) -> Any:
    """Direct download for authenticated users.

    Args:
        username: Target account username.
        filename: Target file name.
        token: Caller credential or scoped file capability, where supported.
        inline: Whether to render the response inline.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Check locks
    file_path, is_locked = await _resolve_content_path(user, username, filename)
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="此資源已被鎖定，請先解鎖")
        # Owner tokens unlock every file; share tokens only their own file.
        if not await token_service.resolves_file_access(token, username, filename):
            raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    # Resolve physical path
    if not file_path.exists():
        raise HTTPException(status_code=404, detail="檔案不存在")

    headers = {
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    }

    if inline:
        return FileResponse(path=file_path, headers=headers)
    return FileResponse(path=file_path, filename=filename, headers=headers)


@router.get("/thumbnail/{username}/{filename}")
@limiter.limit(TUS_LIMIT)
async def get_thumbnail(
    request: Request,
    username: str,
    filename: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
    version: Optional[str] = None,
) -> Any:
    """Get a thumbnail for a file.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        filename: Target file name.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.
        version: Optional cache identity for an immutable thumbnail URL.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    file_path, is_locked = await _resolve_content_path(user, username, filename)
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="Locked resource")
        # Owner tokens unlock every file; share tokens only their own file.
        if not await token_service.resolves_file_access(token, username, filename):
            raise HTTPException(status_code=403, detail="Invalid token")

    thumb_path = await thumbnail_service.get_thumbnail(file_path)
    if thumb_path:
        thumbnail_path = Path(thumb_path)
        if thumbnail_path == file_path:
            identity_path = await run_in_threadpool(thumbnail_service._get_cache_path, file_path)
        else:
            identity_path = thumbnail_path
        identity = identity_path.stem
        etag = f'"{identity}"'
        headers = {
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
            "ETag": etag,
            "Cache-Control": (
                "private, max-age=31536000, immutable" if version == identity
                else "private, no-cache"
            ),
        }
        validators = request.headers.get("if-none-match", "")
        if any(value.strip().removeprefix("W/") in {etag, "*"} for value in validators.split(",")):
            return Response(status_code=304, headers=headers)
        return FileResponse(path=thumb_path, headers=headers)

    raise HTTPException(status_code=404, detail="Thumbnail not available")


@router.post("/user/{username}/batch-action")
async def batch_action(
    request: Request,
    username: str,
    data: BatchActionRequest,
    authorization: Optional[str] = Header(None),
) -> Any:
    """Perform action on multiple items.

    Args:
        request: Incoming HTTP request.
        username: Target account username.
        data: Validated batch action payload.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or data.token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(token, username):
        auth_success = True
    elif data.password:
        p_user = await user_service.get_user_by_password(data.password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    success_count = 0
    errors = []

    for item_id in data.item_ids:
        try:
            if data.action == "delete":
                if data.item_type == "file":
                    if await file_service.is_file_locked(user["folder"], item_id):
                        continue

                    from backend.services.database import get_files_db

                    db = await get_files_db()
                    cursor = await db.execute(
                        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
                        (user["folder"], item_id),
                    )
                    row = await cursor.fetchone()
                    fid = row["folder_id"] if row else None
                    path = await user_service.get_folder_path_names(username, fid)

                    if await file_service.delete_file(user["folder"], item_id, path):
                        success_count += 1
                elif data.item_type == "url":
                    await note_service.delete_url(username, item_id)
                    success_count += 1

            elif data.action == "lock":
                if data.item_type == "file":
                    if await file_service.toggle_file_lock(
                        user["folder"], item_id, True
                    ):
                        success_count += 1
                elif data.item_type == "url":
                    if await note_service.toggle_url_lock(username, item_id, True):
                        success_count += 1

            elif data.action == "unlock":
                if data.item_type == "file":
                    if await file_service.toggle_file_lock(
                        user["folder"], item_id, False
                    ):
                        success_count += 1
                elif data.item_type == "url":
                    if await note_service.toggle_url_lock(username, item_id, False):
                        success_count += 1

        except Exception as e:
            errors.append(f"{item_id}: {str(e)}")

    await event_service.notify_user_update(username)
    return {"message": f"成功處理 {success_count} 個項目", "errors": errors}


@router.post("/user/{username}/batch-download")
async def batch_download(
    username: str,
    filenames: List[str] = Form(...),
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Download multiple files as a zip archive.

    Args:
        username: Target account username.
        filenames: File names to include in the archive.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Authenticate
    auth_success = False
    if await token_service.resolves_owner(token, username):
        auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    folders_by_id = {
        folder["id"]: folder
        for folder in user["folders"]
    }

    # Bulk-load placement and effective lock state (file or ancestor folder)
    access_by_name = await file_service.get_file_access_records(
        user["folder"], username, filenames, folders_by_id
    )

    # Check if any file is locked — require authentication if so
    has_locked = any(record.is_locked for record in access_by_name.values())

    if has_locked or user["is_locked"]:
        if not auth_success:
            raise HTTPException(
                status_code=403, detail="部分檔案已鎖定或目錄已加密，需要驗證"
            )

    entries: list[tuple[Path, str]] = []
    for filename in filenames:
        record = access_by_name.get(filename)
        folder_id = record.folder_id if record else None
        path_names = user_service.folder_path_names_from_map(folders_by_id, folder_id)
        folder_path = file_service.upload_base / user["folder"] / Path(*path_names)
        archive_name = os.path.join(*path_names, filename) if path_names else filename
        entries.append((folder_path / filename, archive_name))
    temp_zip_path = await create_archive(entries)

    return FileResponse(
        path=temp_zip_path,
        filename=f"{username}_batch_download.zip",
        background=BackgroundTask(os.unlink, temp_zip_path),
    )
