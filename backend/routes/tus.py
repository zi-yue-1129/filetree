"""
TUS Protocol Endpoints for Resumable Uploads

Implements TUS 1.0.0 protocol with Local Filesystem backend.
Enables refresh-resume and efficient direct-to-disk uploads.
"""

import base64
import asyncio
import weakref
import logging
import os
import secrets
import uuid
from typing import Any, Optional

import aiofiles
from fastapi import APIRouter, BackgroundTasks, Header, HTTPException, Request, status
from fastapi.responses import Response
from starlette.requests import ClientDisconnect
from starlette.concurrency import run_in_threadpool

from backend.config import settings
from backend.core.auth import extract_bearer_token
from backend.core.rate_limit import limiter
from backend.services.audit_service import AuditService
from backend.services.device_service import device_service
from backend.services.event_service import event_service
from backend.services.file_service import file_service
from backend.services.push_service import push_service
from backend.services.token_service import (
    OWNER_TOKEN_TYPES,
    hash_token,
    token_service,
)
from backend.services.tus_metadata_store import TusMetadataStore
from backend.services.upload_folder_service import (
    resolve_upload_folder,
    validate_folder,
)
from backend.services.user_service import user_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# TUS Protocol Constants
TUS_VERSION = "1.0.0"
CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks (aligned with R2 Multipart)

# Initialize services
metadata_store = TusMetadataStore()
_upload_locks: weakref.WeakValueDictionary[str, asyncio.Lock] = weakref.WeakValueDictionary()
audit_service = AuditService(
    os.path.join(settings.paths.user_info_file.parent, "audit_logs.json")
)
# event_service imported as singleton


def parse_tus_metadata(metadata_header: Optional[str]) -> dict:
    """Parse TUS Upload-Metadata header (Base64-encoded key-value pairs).

    Args:
        metadata_header: Base64-encoded TUS metadata header.

    Returns:
        Decoded metadata values.
    """
    if not metadata_header:
        return {}

    result = {}
    for pair in metadata_header.split(","):
        pair = pair.strip()
        if " " not in pair:
            continue
        key, value = pair.split(" ", 1)
        try:
            decoded = base64.b64decode(value).decode("utf-8")
            result[key] = decoded
        except Exception as e:
            logger.warning(f"Failed to decode metadata {key}: {e}")

    return result


def calculate_fingerprint(
    filename: str, size: int, modified: Optional[str] = None
) -> str:
    """Calculate file fingerprint for resume detection (matches Uppy's logic).

    Args:
        filename: Target file name.
        size: Total upload size in bytes.
        modified: Optional client last-modified value.

    Returns:
        Resume fingerprint.
    """
    parts = [filename, str(size)]
    if modified:
        parts.append(modified)
    return "-".join(parts)


async def finalize_upload_local(upload: dict[str, Any]) -> None:
    """Finalize upload: move from temp to user folder, notify.

    Args:
        upload: Persisted upload session and metadata.
    """
    upload_id = upload["id"]
    username = upload["username"]
    filename = upload["filename"]

    logger.info(f"Finalizing Local TUS upload {upload_id} for user {username}...")

    try:
        # 1. Path to temp file
        temp_path = settings.paths.tus_temp_folder / upload_id

        if not temp_path.exists():
            logger.error(f"Temp file not found: {temp_path}")
            return

        # 2. Import to user folder (dedup & move)
        # This is an instant move on same filesystem
        folder_id = upload["metadata"].get("folder_id")
        await validate_folder(username, folder_id)
        user = await user_service.get_user_by_name(username)
        if user is None:
            raise ValueError("Upload owner no longer exists")
        path_names = await user_service.get_folder_path_names(username, folder_id)
        final_name = await file_service.import_file(
            temp_path, user["folder"], filename, path_names, folder_id
        )

        if not final_name:
            logger.error(f"Failed to import file to user folder: {filename}")
            return

        logger.info(f"File imported successfully as: {final_name}")

        # 3. Notify & Audit
        await audit_service.log_event(
            username,
            "FILE_UPLOAD_TUS",
            f"TUS Upload completed (Local): {final_name}",
            ip="TUS_LOCAL",
        )
        await event_service.notify_user_update(username)
        push_service.schedule_files_added(username, upload["metadata"].get("device_id"))

    except Exception as e:
        logger.error(
            f"Error in finalize_upload_local for {upload_id}: {e}", exc_info=True
        )


@router.post("/upload/tus")
@limiter.limit(settings.rate_limit.tus_limit)
async def create_tus_upload(
    request: Request,
    upload_length: int = Header(..., alias="Upload-Length"),
    upload_metadata: Optional[str] = Header(None, alias="Upload-Metadata"),
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable"),
) -> Response:
    """TUS POST - Create new upload or return existing one for resume.

    Args:
        request: Incoming HTTP request.
        upload_length: Declared total upload size in bytes.
        upload_metadata: Base64-encoded TUS metadata header.
        tus_resumable: Client TUS protocol version.

    Returns:
        Endpoint response.
    """
    try:
        # Parse metadata
        metadata = parse_tus_metadata(upload_metadata)
        filename = metadata.get("filename", "unnamed")
        content_type = metadata.get("filetype", "application/octet-stream")
        password = metadata.get("password")
        token = (
            extract_bearer_token(request.headers.get("authorization"))
            or request.query_params.get("token")
            or metadata.get("token")
        )

        # Authenticate
        user = None
        authenticated_token = None
        if token:
            # Only owner (session/access) tokens may upload; share tokens may not.
            owner = await token_service.resolve_owner_username(token)
            if owner:
                user = await user_service.get_user_by_name(owner)
                if user is not None:
                    authenticated_token = token

        if not user and password:
            user = await user_service.get_user_by_password(password)

        if not user:
            raise HTTPException(status_code=401, detail="驗證失敗")

        folder_id = await resolve_upload_folder(
            user["username"], metadata.get("folder_id"), metadata.get("relativePath")
        )
        device = await device_service.resolve_token(authenticated_token)
        metadata.pop("token", None)
        metadata.pop("password", None)
        metadata.pop("device_id", None)
        metadata.pop("auth_token_hash", None)
        metadata.pop("password_hash", None)
        metadata["folder_id"] = folder_id
        if device is not None:
            metadata["device_id"] = device["id"]
        elif authenticated_token:
            metadata["auth_token_hash"] = hash_token(authenticated_token)
        else:
            metadata["password_hash"] = user["hashed_password"]

        # Calculate fingerprint
        fingerprint = (
            calculate_fingerprint(filename, upload_length, metadata.get("lastModified"))
            + ":"
            + (folder_id or "root")
        )
        logger.info(
            f"TUS Create: fingerprint={fingerprint}, size={upload_length}, user={user['username']}"
        )

        # Check for existing upload (resume)
        existing = await run_in_threadpool(
            metadata_store.get_upload_by_fingerprint, fingerprint, user["username"]
        )

        if existing and not await _has_active_origin(existing):
            await run_in_threadpool(metadata_store.mark_aborted, existing["id"])
            (settings.paths.tus_temp_folder / existing["id"]).unlink(missing_ok=True)
            existing = None

        if existing and existing["status"] == "active":
            logger.info(
                f"TUS Resume: Found existing upload {existing['id']}, offset={existing['offset']}"
            )
            return Response(
                status_code=200,
                headers={
                    "Location": f"{request.base_url}api/upload/tus/{existing['id']}",
                    "Tus-Resumable": TUS_VERSION,
                    "Upload-Offset": str(existing["offset"]),
                    "Content-Length": "0",
                },
            )

        # Create new upload
        upload_id = str(uuid.uuid4())

        # Create empty file
        file_path = settings.paths.tus_temp_folder / upload_id
        try:
            file_path.parent.mkdir(parents=True, exist_ok=True)
            file_path.touch()
        except Exception as e:
            logger.error(f"Failed to create temp file: {e}")
            raise HTTPException(
                status_code=500, detail="Failed to initialize upload storage"
            )

        # Store metadata
        created = await run_in_threadpool(
            metadata_store.create_upload,
            upload_id=upload_id,
            fingerprint=fingerprint,
            username=user["username"],
            size=upload_length,
            filename=filename,
            content_type=content_type,
            metadata=metadata,
        )

        if not created:
            # Cleanup
            file_path.unlink(missing_ok=True)
            raise HTTPException(
                status_code=500, detail="Failed to create upload session"
            )

        logger.info(f"Created Local TUS upload: {upload_id} for {filename}")

        return Response(
            status_code=status.HTTP_201_CREATED,
            headers={
                "Location": f"{request.base_url}api/upload/tus/{upload_id}",
                "Tus-Resumable": TUS_VERSION,
                "Upload-Offset": "0",
                "Content-Length": "0",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TUS Create Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


async def _has_active_origin(upload: dict[str, Any]) -> bool:
    """Check the original credential without trusting the upload URL alone."""
    stored = upload["metadata"]
    device_id = stored.get("device_id")
    if device_id:
        device = await device_service.get_active(device_id)
        return device is not None and device["username"] == upload["username"]
    token_hash = stored.get("auth_token_hash")
    if token_hash:
        info = token_service.validate_hash(token_hash)
        if (
            info is not None
            and info.token_type in OWNER_TOKEN_TYPES
            and info.username == upload["username"]
        ):
            return True
    user = await user_service.get_user_by_name(upload["username"])
    password_hash = stored.get("password_hash")
    if (
        user is not None
        and password_hash
        and secrets.compare_digest(password_hash, user["hashed_password"])
    ):
        return True
    # Allow credentials stored by older records until those uploads expire.
    if await token_service.resolves_owner(stored.get("token"), upload["username"]):
        return True
    legacy_password = stored.get("password")
    if legacy_password:
        legacy_user = await user_service.get_user_by_password(legacy_password)
        return legacy_user is not None and legacy_user["username"] == upload["username"]
    return False


async def _authorize_upload(request: Request, upload: dict[str, Any]) -> None:
    """Recheck credentials and device revocation on every upload continuation."""
    if upload["metadata"].get("device_id") and not await _has_active_origin(upload):
        raise HTTPException(status_code=403, detail="Uploading device has been revoked")
    supplied = (
        extract_bearer_token(request.headers.get("authorization"))
        or request.query_params.get("token")
        or parse_tus_metadata(request.headers.get("upload-metadata")).get("token")
    )
    if supplied:
        if not await token_service.resolves_owner(supplied, upload["username"]):
            raise HTTPException(status_code=403, detail="Invalid upload owner token")
        return
    # Upload IDs remain continuation capabilities for existing Uppy clients.
    # Their initiating credentials are rechecked without persisting plaintext.
    if await _has_active_origin(upload):
        return
    raise HTTPException(status_code=403, detail="Upload credential has expired")


@router.head("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def get_tus_upload_offset(
    request: Request,
    upload_id: str,
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable"),
) -> Response:
    """TUS HEAD - Get current upload offset.

    Args:
        request: Incoming HTTP request.
        upload_id: Upload session identifier.
        tus_resumable: Client TUS protocol version.

    Returns:
        Endpoint response.
    """
    upload = await run_in_threadpool(metadata_store.get_upload, upload_id)

    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await _authorize_upload(request, upload)

    return Response(
        status_code=200,
        headers={
            "Tus-Resumable": TUS_VERSION,
            "Upload-Offset": str(upload["offset"]),
            "Upload-Length": str(upload["size"]),
            "Cache-Control": "no-store",
            "Content-Length": "0",
        },
    )


@router.patch("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def upload_tus_chunk(
    upload_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    upload_offset: int = Header(..., alias="Upload-Offset"),
    content_length: int = Header(..., alias="Content-Length"),
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable"),
) -> Response:
    """TUS PATCH - Upload a chunk of data.

    Args:
        upload_id: Upload session identifier.
        request: Incoming HTTP request.
        background_tasks: Tasks scheduled after the upload response.
        upload_offset: Expected upload offset in bytes.
        content_length: Declared chunk content length in bytes.
        tus_resumable: Client TUS protocol version.

    Returns:
        Endpoint response.
    """
    lock = _upload_locks.get(upload_id)
    if lock is None:
        lock = asyncio.Lock()
        _upload_locks[upload_id] = lock
    async with lock:
        upload = await run_in_threadpool(metadata_store.get_upload, upload_id)

        if not upload:
            raise HTTPException(status_code=404, detail="Upload not found")
        await _authorize_upload(request, upload)

        # Verify offset
        current_offset = upload["offset"]
        if upload_offset != current_offset:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail=f"Offset mismatch. Expected {current_offset}, got {upload_offset}",
            )

        # File path
        file_path = settings.paths.tus_temp_folder / upload_id
        if not file_path.exists():
            raise HTTPException(status_code=404, detail="Upload file not found on server")

        # The database offset is authoritative; partial or disconnected chunks roll back.
        if content_length < 0 or current_offset + content_length > upload["size"]:
            raise HTTPException(status_code=400, detail="Upload exceeds total size")
        chunk_size = 0
        try:
            async with aiofiles.open(file_path, "r+b") as output:
                await output.seek(current_offset)
                await output.truncate(current_offset)
                try:
                    async for chunk in request.stream():
                        chunk_size += len(chunk)
                        if chunk_size > content_length:
                            raise HTTPException(status_code=400, detail="Chunk exceeds Content-Length")
                        await output.write(chunk)
                    if chunk_size != content_length:
                        raise HTTPException(status_code=400, detail="Chunk does not match Content-Length")
                except BaseException:
                    await output.truncate(current_offset)
                    raise
        except ClientDisconnect:
            logger.warning("Client disconnected during upload of %s", upload_id)
            return Response(status_code=499)
        except OSError as error:
            raise HTTPException(status_code=500, detail="Failed to write chunk") from error

        new_offset = current_offset + chunk_size
        updated = await run_in_threadpool(metadata_store.update_offset, upload_id, new_offset, [])
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to persist upload offset")

        logger.info(f"TUS Chunk {upload_id}: +{chunk_size} bytes, new_offset={new_offset}")

        # Complete if done
        if new_offset == upload["size"]:
            logger.info(f"TUS Complete (Local): {upload_id}")
            await run_in_threadpool(metadata_store.mark_completed, upload_id)
            # Trigger finalization (can be awaited or background, strictly speaking instant move is fast enough)
            background_tasks.add_task(finalize_upload_local, upload)

        return Response(
            status_code=status.HTTP_204_NO_CONTENT,
            headers={"Upload-Offset": str(new_offset), "Tus-Resumable": TUS_VERSION},
        )

@router.delete("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def cancel_tus_upload(
    request: Request,
    upload_id: str,
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable"),
) -> Response:
    """TUS DELETE - Cancel upload and clean up.

    Args:
        request: Incoming HTTP request.
        upload_id: Upload session identifier.
        tus_resumable: Client TUS protocol version.

    Returns:
        Endpoint response.
    """
    upload = await run_in_threadpool(metadata_store.get_upload, upload_id)

    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await _authorize_upload(request, upload)

    logger.info(f"TUS Delete: upload_id={upload_id}")

    # Abort local upload
    await run_in_threadpool(metadata_store.mark_aborted, upload_id)

    file_path = settings.paths.tus_temp_folder / upload_id
    if file_path.exists():
        try:
            file_path.unlink()
            logger.info(f"Deleted temp file for aborted upload: {upload_id}")
        except Exception as e:
            logger.error(f"Failed to delete temp file: {e}")

    return Response(status_code=204, headers={"Tus-Resumable": TUS_VERSION})


def cleanup_expired_uploads() -> None:
    """Cleanup stale TUS uploads (DB + Files)."""
    try:
        # 1 day expiration
        expired_ids = metadata_store.cleanup_stale_uploads(days=1)

        count = 0
        for uid in expired_ids:
            file_path = settings.paths.tus_temp_folder / uid
            if file_path.exists():
                try:
                    file_path.unlink()
                    count += 1
                except Exception as e:
                    logger.error(f"Failed to delete stale file {uid}: {e}")

        if expired_ids:
            logger.info(
                f"Cleaned up {len(expired_ids)} stale uploads and {count} files."
            )

    except Exception as e:
        logger.error(f"Cleanup error: {e}")


@router.options("/upload/tus")
@router.options("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def tus_options(request: Request) -> Response:
    """TUS OPTIONS - Advertise server capabilities.

    Args:
        request: Incoming HTTP request.

    Returns:
        Endpoint response.
    """
    return Response(
        status_code=204,
        headers={
            "Tus-Resumable": TUS_VERSION,
            "Tus-Version": TUS_VERSION,
            "Tus-Extension": "creation,termination",
            # "Tus-Max-Size": str(10 * 1024 * 1024 * 1024),  # 10GB - REMOVED for clarity
        },
    )
