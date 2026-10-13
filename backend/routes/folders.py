"""Owner-scoped folder management, item placement, and folder downloads."""

import os
from pathlib import Path
from collections import defaultdict
from typing import Any, Optional

from fastapi import APIRouter, Form, Header, HTTPException
from fastapi.responses import FileResponse
from starlette.background import BackgroundTask

from backend.core.auth import extract_bearer_token
from backend.services.archive_service import create_archive
from backend.services.event_service import event_service
from backend.services.file_service import file_service
from backend.services.note_service import note_service
from backend.services.token_service import token_service
from backend.services.user_service import user_service

router = APIRouter()


@router.post("/user/{username}/folders")
async def create_folder(
    username: str,
    name: str = Form(...),
    folder_type: str = Form(...),
    password: Optional[str] = Form(None),
    token: Optional[str] = Form(None),
    parent_id: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Create a new folder for files or URLs.

    Args:
        username: Target account username.
        name: Folder display name.
        folder_type: File or URL folder type.
        password: Optional account password.
        token: Caller credential or scoped file capability, where supported.
        parent_id: Optional parent folder identifier.
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
    password: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Update a folder name.

    Args:
        username: Target account username.
        folder_id: Target folder identifier.
        name: Folder display name.
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
    password: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Delete a folder and its physical content.

    Args:
        username: Target account username.
        folder_id: Target folder identifier.
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
    password: Optional[str] = Form(None),
    authorization: Optional[str] = Header(None),
) -> Any:
    """Move an item (file, url, or folder) to a folder.

    Args:
        username: Target account username.
        item_type: File, URL, or folder item type.
        item_id: Item identifier.
        folder_id: Target folder identifier.
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
                import asyncio
                import shutil

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


@router.get("/user/{username}/folders/{folder_id}/download")
async def download_folder(
    username: str,
    folder_id: str,
    token: Optional[str] = None,
    authorization: Optional[str] = Header(None),
) -> Any:
    """Download a specific folder as a zip archive.

    Args:
        username: Target account username.
        folder_id: Target folder identifier.
        token: Caller credential or scoped file capability, where supported.
        authorization: Optional Bearer authorization header.

    Returns:
        Endpoint response.
    """
    token = extract_bearer_token(authorization) or token
    user = await user_service.get_user_by_name(username)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    target_folder = await user_service.get_folder_by_id(folder_id)
    if not target_folder:
        raise HTTPException(status_code=404, detail="Folder not found")

    is_authenticated = False
    if await token_service.resolves_owner(token, username):
        is_authenticated = True

    if target_folder["is_locked"] and not is_authenticated:
        raise HTTPException(status_code=403, detail="Folder is locked")

    all_folders = await user_service.get_folders_by_username(username)
    folder_map = {f["id"]: f for f in all_folders}

    # 1. Identify all descendant folder IDs
    children: dict[str, list[str]] = defaultdict(list)
    for folder in all_folders:
        if folder["parent_id"]:
            children[folder["parent_id"]].append(folder["id"])
    descendants = set()
    stack = [folder_id]
    while stack:
        current_id = stack.pop()
        if current_id in descendants:
            continue
        descendants.add(current_id)
        stack.extend(children[current_id])

    # 2. Check locks in descendants if unauthenticated
    if not is_authenticated:
        for fid in descendants:
            if folder_map.get(fid, {}).get("is_locked"):
                raise HTTPException(status_code=403, detail="Contains locked content")

    # 3. Get all files and filter
    files = await file_service.get_user_files(
        user["folder"], user.get("data_retention_days")
    )
    target_files = [f for f in files if f["folder_id"] in descendants]

    if not target_files:
        raise HTTPException(status_code=404, detail="Folder is empty")

    if not is_authenticated:
        for f in target_files:
            if f["is_locked"]:
                raise HTTPException(status_code=403, detail="Contains locked files")

    target_root_path = user_service.folder_path_names_from_map(folder_map, folder_id)
    strip_count = max(0, len(target_root_path) - 1)
    entries: list[tuple[Path, str]] = []
    for file_info in target_files:
        path_names = user_service.folder_path_names_from_map(folder_map, file_info["folder_id"])
        file_path = file_service.upload_base / user["folder"] / Path(*path_names) / file_info["name"]
        archive_name = os.path.join(*path_names[strip_count:], file_info["name"])
        entries.append((file_path, archive_name))
    temp_zip_path = await create_archive(entries)

    return FileResponse(
        path=temp_zip_path,
        filename=f"{target_folder['name']}.zip",
        background=BackgroundTask(os.unlink, temp_zip_path),
    )
