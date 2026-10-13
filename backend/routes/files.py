from typing import List, Optional
from fastapi import APIRouter, HTTPException, Request, Form, UploadFile, File, Depends
from fastapi.responses import FileResponse, JSONResponse
from starlette.background import BackgroundTask
from backend.services.user_service import user_service
from backend.services.file_service import file_service
from backend.services.note_service import note_service
from backend.services.token_service import token_service
from backend.services.audit_service import AuditService
from backend.services.event_service import event_service
from backend.services.thumbnail_service import thumbnail_service
from backend.schemas import FileInfo, URLRecord, BatchActionRequest, ShareInfo
from backend.core.auth import verify_password, get_current_user_token, verify_ownership
from backend.core.rate_limit import limiter, UPLOAD_LIMIT, TUS_LIMIT
from backend.core.utils import get_client_ip
from backend.config import settings
from datetime import datetime
import os

router = APIRouter()
audit_service = AuditService(os.path.join(settings.paths.user_info_file.parent, "audit_logs.json"))


@router.get("/files/{username}", response_model=List[FileInfo])
async def get_files(username: str, token: Optional[str] = None):
    """List files for a specific user."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Access control: If user is locked, require a valid token
    if user["is_locked"]:
        if not token:
            raise HTTPException(status_code=401, detail="此目錄已鎖定，請先解鎖")
        info = token_service.validate_token(token)
        if not info or info.username != username:
            raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    return await file_service.get_user_files(
        user["folder"],
        retention_days=user.get("data_retention_days"),
    )


@router.post("/upload")
@limiter.limit(UPLOAD_LIMIT)
async def upload_files(
    request: Request,
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    files: List[UploadFile] = File(...),
    folder_id: Optional[str] = Form(None)
):
    """Handle multiple file uploads into a specific folder."""
    user = None
    if password:
        user = await user_service.get_user_by_password(password)
    elif token:
        info = token_service.validate_token(token)
        if info:
            user = await user_service.get_user_by_name(info.username)
            
    if not user:
        raise HTTPException(status_code=401, detail="驗證失敗，請重新登入或驗證密碼")

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
        user["username"], "FILE_UPLOAD",
        f"Uploaded {len(uploaded)} files: {', '.join(uploaded)}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(user["username"])

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
    url: str = Form(...)
):
    """Handle URL submission."""
    user = None
    if password:
        user = await user_service.get_user_by_password(password)
    elif token:
        info = token_service.validate_token(token)
        if info:
            user = await user_service.get_user_by_name(info.username)

    if not user:
        raise HTTPException(status_code=401, detail="驗證失敗")

    await note_service.add_url(user["username"], url)

    await audit_service.log_event(
        user["username"], "NOTE_CREATE",
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
    password: Optional[str] = Form(None)
):
    """Delete a file from user's folder."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
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
        username, "FILE_DELETE", f"Deleted file: {filename}",
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
    new_name: str = Form(...)
):
    """Rename a file."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
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
        raise HTTPException(status_code=400, detail="重新命名失敗（檔案不存在或名稱重複）")

    await audit_service.log_event(
        username, "FILE_RENAME", f"Renamed {old_name} to {new_name}",
        ip=get_client_ip(request),
    )
    await event_service.notify_user_update(username)
    return {"message": "檔案重新命名成功"}


@router.post("/share/{username}/{filename}")
async def create_share(
    username: str,
    filename: str,
    token: Optional[str] = Form(None)
):
    """Generate a temporary sharing token for a file."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Check locks
    is_locked = user["is_locked"] or await file_service.is_file_locked(
        user["folder"], filename
    )
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="此資源已被鎖定，請先解鎖")
        info = token_service.validate_token(token)
        if not info or info.username != username:
            raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    share_token = token_service.create_token(username, filename)
    return {
        "success": True,
        "token": share_token,
        "expiry_hours": token_service.expiry_hours,
    }


@router.get("/share-info/{token}", response_model=ShareInfo)
async def get_share_info(token: str):
    """Retrieve info about a shared file."""
    info = token_service.validate_token(token)
    if not info:
        raise HTTPException(status_code=404, detail="分享連結已過期或無效")

    user = await user_service.get_user_by_name(info.username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Resolve physical path from files.db
    from backend.services.database import get_files_db
    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id, size_bytes, is_locked FROM files "
        "WHERE username = ? AND filename = ?",
        (user["folder"], info.filename),
    )
    row = await cursor.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="檔案不存在")

    size_bytes = row["size_bytes"]
    size_mb = round(size_bytes / (1024 * 1024), 2)
    size_str = f"{size_mb} MB" if size_mb >= 0.1 else f"{round(size_bytes/1024, 2)} KB"

    preview_url = f"/api/download/{info.username}/{info.filename}?token={token}&inline=true"
    download_url = f"/api/download-shared/{token}"
    thumbnail_url = f"/api/thumbnail/{info.username}/{info.filename}?token={token}"

    return ShareInfo(
        username=info.username,
        filename=info.filename,
        size=size_str,
        size_bytes=size_bytes,
        expiry=info.expiry,
        is_locked=bool(row["is_locked"]),
        preview_url=preview_url,
        download_url=download_url,
        thumbnail_url=thumbnail_url
    )


@router.get("/download-shared/{token}")
async def download_shared(token: str):
    """Download a file via a share token."""
    info = token_service.validate_token(token)
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
        }
    )


@router.get("/download/{username}/{filename}")
async def download_direct(
    username: str,
    filename: str,
    token: Optional[str] = None,
    inline: Optional[bool] = None
):
    """Direct download for authenticated users."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Check locks
    is_locked = user["is_locked"] or await file_service.is_file_locked(
        user["folder"], filename
    )
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="此資源已被鎖定，請先解鎖")
        
        info = token_service.validate_token(token)
        if not info or info.username != username:
            # Check share token (must match filename) OR session token (must match username)
            is_valid_share = (info and info.token_type == 'share' 
                            and info.filename == filename and info.username == username)
            is_valid_session = (info and info.token_type == 'session' and info.username == username)
            is_valid_access = (info and info.token_type == 'access' and info.username == username)

            if not (is_valid_share or is_valid_session or is_valid_access):
                raise HTTPException(status_code=403, detail="無效或過期的存取權杖")

    # Resolve physical path
    from backend.services.database import get_files_db
    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
        (user["folder"], filename),
    )
    row = await cursor.fetchone()
    folder_id = row["folder_id"] if row else None
    path_names = await user_service.get_folder_path_names(username, folder_id)
    folder = file_service._get_folder_path(user["folder"], path_names)
    file_path = folder / filename

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
    token: Optional[str] = None
):
    """Get a thumbnail for a file."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    is_locked = user["is_locked"] or await file_service.is_file_locked(
        user["folder"], filename
    )
    if is_locked:
        if not token:
            raise HTTPException(status_code=403, detail="Locked resource")
        
        info = token_service.validate_token(token)
        if not info or info.username != username:
            is_valid_share = (info and info.token_type == 'share' 
                            and info.filename == filename and info.username == username)
            is_valid_session = (info and info.token_type == 'session' and info.username == username)

            if not (is_valid_share or is_valid_session):
                raise HTTPException(status_code=403, detail="Invalid token")

    from backend.services.database import get_files_db
    db = await get_files_db()
    cursor = await db.execute(
        "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
        (user["folder"], filename),
    )
    row = await cursor.fetchone()
    folder_id = row["folder_id"] if row else None
    path_names = await user_service.get_folder_path_names(username, folder_id)
    folder = file_service._get_folder_path(user["folder"], path_names)
    file_path = folder / filename

    thumb_path = await thumbnail_service.get_thumbnail(file_path)
    if thumb_path:
        return FileResponse(
            path=thumb_path,
            headers={
                "X-Content-Type-Options": "nosniff",
                "Content-Security-Policy": "default-src 'none'; sandbox",
            }
        )

    raise HTTPException(status_code=404, detail="Thumbnail not available")


@router.post("/user/{username}/folders")
async def create_folder(
    username: str,
    name: str = Form(...),
    folder_type: str = Form(...),
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    parent_id: Optional[str] = Form(None)
):
    """Create a new folder for files or URLs."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    if parent_id:
        parent = await user_service.get_folder_by_id(parent_id)
        if not parent:
            raise HTTPException(status_code=400, detail="父資料夾不存在")

    try:
        folder_id = await user_service.add_folder(
            username, name, folder_type, parent_id
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    if not folder_id:
        raise HTTPException(status_code=500, detail="建立資料夾失敗")

    # Create physical directory for file folders
    if folder_type == "file":
        path = await user_service.get_folder_path_names(username, folder_id)
        file_service._get_folder_path(user["folder"], path)

    await event_service.notify_user_update(username)
    return {"status": "success", "folder_id": folder_id}


@router.post("/user/{username}/folders/{folder_id}/update")
async def update_folder(
    username: str,
    folder_id: str,
    name: str = Form(...),
    token: Optional[str] = Form(None),
    password: Optional[str] = Form(None)
):
    """Update a folder name."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    target_folder = await user_service.get_folder_by_id(folder_id)
    if not target_folder:
        raise HTTPException(status_code=404, detail="找不到資料夾")

    if target_folder["type"] == "file":
        parent_path = await user_service.get_folder_path_names(
            username, target_folder["parent_id"]
        )
        await file_service.rename_physical_folder(
            user["folder"], parent_path, target_folder["name"], name
        )

    success = await user_service.update_folder(username, folder_id, name)
    if not success:
        raise HTTPException(status_code=500, detail="更新資料夾失敗")

    await event_service.notify_user_update(username)
    return {"status": "success"}


@router.post("/user/{username}/folders/{folder_id}/delete")
async def delete_folder(
    username: str,
    folder_id: str,
    token: Optional[str] = Form(None),
    password: Optional[str] = Form(None)
):
    """Delete a folder and its physical content."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    target_folder = await user_service.get_folder_by_id(folder_id)
    if not target_folder:
        raise HTTPException(status_code=404, detail="找不到資料夾")

    if target_folder["type"] == "file":
        path = await user_service.get_folder_path_names(username, folder_id)
        await file_service.delete_physical_folder(user["folder"], path)

    success = await user_service.delete_folder(username, folder_id)
    if not success:
        raise HTTPException(status_code=500, detail="刪除資料夾失敗")

    await event_service.notify_user_update(username)
    return {"status": "success"}


@router.post("/user/{username}/move-item")
async def move_item(
    username: str,
    item_type: str = Form(...),
    item_id: str = Form(...),
    folder_id: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    password: Optional[str] = Form(None)
):
    """Move an item (file, url, or folder) to a folder."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="使用者不存在")

    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    if not auth_success:
        raise HTTPException(status_code=401, detail="驗證失敗")

    if item_type == "file":
        # Get old folder_id from files.db
        from backend.services.database import get_files_db
        db = await get_files_db()
        cursor = await db.execute(
            "SELECT folder_id FROM files WHERE username = ? AND filename = ?",
            (user["folder"], item_id),
        )
        row = await cursor.fetchone()
        old_folder_id = row["folder_id"] if row else None
        from_path = await user_service.get_folder_path_names(username, old_folder_id)
        to_path = await user_service.get_folder_path_names(username, folder_id)
        await file_service.move_file(
            user["folder"], item_id, from_path, to_path, folder_id
        )

    elif item_type == "url":
        await note_service.move_url(username, item_id, folder_id)

    elif item_type == "folder":
        target_folder = await user_service.get_folder_by_id(item_id)
        if not target_folder:
            raise HTTPException(status_code=404, detail="找不到項目資料夾")

        if target_folder["type"] == "file":
            old_parent_path = await user_service.get_folder_path_names(
                username, target_folder["parent_id"]
            )
            new_parent_path = await user_service.get_folder_path_names(
                username, folder_id
            )
            old_dir = (
                file_service._get_folder_path(user["folder"], old_parent_path)
                / target_folder["name"]
            )
            new_dir = (
                file_service._get_folder_path(user["folder"], new_parent_path)
                / target_folder["name"]
            )
            if old_dir.exists() and old_dir.is_dir():
                import shutil
                import asyncio
                loop = asyncio.get_event_loop()
                try:
                    await loop.run_in_executor(
                        None, shutil.move, str(old_dir), str(new_dir)
                    )
                except Exception as e:
                    raise HTTPException(
                        status_code=500,
                        detail=f"物理資料夾移動失敗: {e}",
                    )

        success = await user_service.move_folder(username, item_id, folder_id)
        if not success:
            raise HTTPException(status_code=400, detail="移動項目失敗或造成循環引用")

    await event_service.notify_user_update(username)
    return {"status": "success"}


@router.post("/user/{username}/batch-action")
async def batch_action(
    request: Request,
    username: str,
    data: BatchActionRequest
):
    """Perform action on multiple items."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Authenticate
    auth_success = False
    if data.token:
        info = token_service.validate_token(data.token)
        if info and info.username == username:
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
                    if await file_service.toggle_file_lock(user["folder"], item_id, True):
                        success_count += 1
                elif data.item_type == "url":
                    if await note_service.toggle_url_lock(username, item_id, True):
                        success_count += 1

            elif data.action == "unlock":
                if data.item_type == "file":
                    if await file_service.toggle_file_lock(user["folder"], item_id, False):
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
    token: Optional[str] = Form(None)
):
    """Download multiple files as a zip archive."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Authenticate
    auth_success = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            auth_success = True
    elif password:
        p_user = await user_service.get_user_by_password(password)
        if p_user and p_user["username"] == username:
            auth_success = True

    from backend.services.database import get_files_db
    db = await get_files_db()

    # Bulk-load file metadata (chunked to stay under SQLite's variable limit)
    file_meta_by_name: dict = {}
    unique_filenames = list(dict.fromkeys(filenames))
    for start in range(0, len(unique_filenames), 500):
        chunk = unique_filenames[start:start + 500]
        placeholders = ",".join("?" for _ in chunk)
        cursor = await db.execute(
            "SELECT filename, folder_id, is_locked FROM files "
            f"WHERE username = ? AND filename IN ({placeholders})",
            (user["folder"], *chunk),
        )
        for row in await cursor.fetchall():
            file_meta_by_name[row["filename"]] = row

    # Check if any file is locked — require authentication if so
    has_locked = any(bool(row["is_locked"]) for row in file_meta_by_name.values())

    if has_locked or user["is_locked"]:
        if not auth_success:
            raise HTTPException(status_code=403, detail="部分檔案已鎖定或目錄已加密，需要驗證")

    import tempfile
    import zipfile

    temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    temp_zip_path = temp_zip.name
    temp_zip.close()

    folders_by_id = {
        folder["id"]: folder
        for folder in await user_service.get_folders_by_username(username)
    }

    with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for fname in filenames:
            row = file_meta_by_name.get(fname)
            fid = row["folder_id"] if row else None
            path_names = user_service.folder_path_names_from_map(folders_by_id, fid)
            folder_path = file_service._get_folder_path(user["folder"], path_names)
            file_path = folder_path / fname

            if file_path.exists():
                arcname = (
                    os.path.join(*path_names, fname) if path_names else fname
                )
                zf.write(file_path, arcname=arcname)

    return FileResponse(
        path=temp_zip_path,
        filename=f"{username}_batch_download.zip",
        background=BackgroundTask(os.unlink, temp_zip_path),
    )


@router.get("/user/{username}/folders/{folder_id}/download")
async def download_folder(
    username: str,
    folder_id: str,
    token: Optional[str] = None
):
    """Download a specific folder as a zip archive."""
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    target_folder = await user_service.get_folder_by_id(folder_id)
    if not target_folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    is_authenticated = False
    if token:
        info = token_service.validate_token(token)
        if info and info.username == username:
            is_authenticated = True

    if target_folder["is_locked"] and not is_authenticated:
        raise HTTPException(status_code=403, detail="Folder is locked")

    all_folders = await user_service.get_folders_by_username(username)
    folder_map = {f["id"]: f for f in all_folders}
    
    # 1. Identify all descendant folder IDs
    descendants = set()
    stack = [folder_id]
    while stack:
        current_id = stack.pop()
        descendants.add(current_id)
        for f in all_folders:
            if f["parent_id"] == current_id:
                stack.append(f["id"])

    # 2. Check locks in descendants if unauthenticated
    if not is_authenticated:
        for fid in descendants:
            if folder_map.get(fid, {}).get("is_locked"):
                raise HTTPException(status_code=403, detail="Contains locked content")

    # 3. Get all files and filter
    files = await file_service.get_user_files(username, user.get("data_retention_days"))
    target_files = [f for f in files if f["folder_id"] in descendants]
    
    if not target_files:
        raise HTTPException(status_code=404, detail="Folder is empty")

    if not is_authenticated:
        for f in target_files:
            if f["is_locked"]:
                raise HTTPException(status_code=403, detail="Contains locked files")

    # 4. Create Zip
    import tempfile
    import zipfile

    temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
    temp_zip_path = temp_zip.name
    temp_zip.close()

    # Helper: resolve path from root
    def get_path_from_root(fid):
        path = []
        curr = fid
        while curr and curr in folder_map:
            f = folder_map[curr]
            path.insert(0, f["name"])
            curr = f["parent_id"]
        return path

    target_root_path = get_path_from_root(folder_id)
    # The number of path components to strip to make paths relative to the zip root
    # e.g. target is "A/B". We want files in B to be at root of zip? 
    # Usually zip of "B" contains "B/file". 
    # If we want "B/...", we strip "A". Length of target_root_path is 2. Strip 1.
    strip_count = max(0, len(target_root_path) - 1)

    with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
        for file_info in target_files:
            fname = file_info["name"]
            fid = file_info["folder_id"]
            
            # Physical path needs names from root
            full_path_names = get_path_from_root(fid)
            
            # Get physical path
            folder_path = file_service._get_folder_path(user["folder"], full_path_names)
            file_path = folder_path / fname
            
            if file_path.exists():
                # Archive path: relative to the parent of the target folder
                rel_path_names = full_path_names[strip_count:]
                arcname = os.path.join(*rel_path_names, fname)
                zf.write(file_path, arcname=arcname)

    return FileResponse(
        path=temp_zip_path,
        filename=f"{target_folder['name']}.zip",
        background=BackgroundTask(os.unlink, temp_zip_path),
    )
