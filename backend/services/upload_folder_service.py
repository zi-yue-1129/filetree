"""Resolve owned upload destinations and idempotent sanitized folder trees."""

import asyncio
from typing import Optional

from fastapi import HTTPException

from backend.services.file_service import file_service
from backend.services.user_service import user_service

_folder_lock = asyncio.Lock()


def sanitize_folder_name(name: str) -> str:
    """Apply the same directory normalization as UserService.add_folder.

    Args:
        name: Untrusted directory name.

    Returns:
        Safe, nonempty physical directory name.

    Raises:
        HTTPException: If the resulting directory name is invalid.
    """
    sanitized = name.strip().replace("/", "_").replace("\\", "_").replace("..", "_")
    if not sanitized or sanitized == "." or "\x00" in sanitized:
        raise HTTPException(status_code=422, detail="Invalid folder name")
    return sanitized


async def validate_folder(username: str, folder_id: Optional[str]) -> None:
    """Reject missing, foreign, or non-file destinations and ancestor chains.

    Args:
        username: Uploading account.
        folder_id: Requested destination, or None for root.

    Raises:
        HTTPException: For an inaccessible destination or corrupt folder tree.
    """
    user = await user_service.get_user_by_name(username)
    if user is None:
        raise HTTPException(status_code=401, detail="Unknown account")
    current = folder_id
    visited: set[str] = set()
    while current:
        if current in visited or len(visited) >= 50:
            raise HTTPException(status_code=400, detail="Invalid folder ancestry")
        visited.add(current)
        folder = await user_service.get_folder_by_id(current)
        if (
            folder is None
            or folder["user_id"] != user["id"]
            or folder["type"] != "file"
        ):
            raise HTTPException(
                status_code=403, detail="Destination is not an owned file folder"
            )
        sanitize_folder_name(folder["name"])
        current = folder["parent_id"]


async def ensure_folder_path(
    username: str,
    names: list[str],
    parent_id: Optional[str] = None,
) -> str:
    """Find or create a file-folder chain under a validated owner destination.

    Args:
        username: Owning account name.
        names: Folder names to normalize and create in sequence.
        parent_id: Starting parent, or account root.

    Returns:
        Final folder identifier.

    Raises:
        HTTPException: For invalid names, incompatible existing folders, or user.
    """
    normalized = [sanitize_folder_name(name) for name in names]
    if not normalized:
        raise HTTPException(status_code=422, detail="Folder path is empty")
    async with _folder_lock:
        await validate_folder(username, parent_id)
        for name in normalized:
            folders = await user_service.get_folders_by_username(username)
            existing = next(
                (
                    folder
                    for folder in folders
                    if folder["name"] == name and folder["parent_id"] == parent_id
                ),
                None,
            )
            if existing is not None:
                if existing["type"] != "file":
                    raise HTTPException(
                        status_code=409,
                        detail="Folder name belongs to a non-file folder",
                    )
                parent_id = existing["id"]
            else:
                parent_id = await user_service.add_folder(
                    username, name, "file", parent_id
                )
                if parent_id is None:
                    raise HTTPException(status_code=401, detail="Unknown account")
        user = await user_service.get_user_by_name(username)
        if user is None:
            raise HTTPException(status_code=401, detail="Unknown account")
        path = await user_service.get_folder_path_names(username, parent_id)
        file_service._get_folder_path(user["folder"], path)
        return parent_id


async def resolve_upload_folder(
    username: str,
    folder_id: Optional[str],
    relative_path: Optional[str],
) -> Optional[str]:
    """Resolve TUS relative directories below an owned destination.

    Args:
        username: Uploading account.
        folder_id: Optional selected file folder.
        relative_path: Client path including the filename.

    Returns:
        Destination folder identifier, or None for root.
    """
    await validate_folder(username, folder_id)
    if not relative_path:
        return folder_id
    parts = relative_path.replace("\\", "/").split("/")
    if any(part in {"", ".", ".."} or "\x00" in part for part in parts):
        raise HTTPException(status_code=422, detail="Invalid relativePath")
    return (
        await ensure_folder_path(username, parts[:-1], folder_id)
        if len(parts) > 1
        else folder_id
    )
