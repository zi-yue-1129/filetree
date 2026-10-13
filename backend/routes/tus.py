"""
TUS Protocol Endpoints for Resumable Uploads

Implements TUS 1.0.0 protocol with Local Filesystem backend.
Enables refresh-resume and efficient direct-to-disk uploads.
"""

from fastapi import APIRouter, Request
from fastapi.responses import Response
from starlette.requests import ClientDisconnect
from fastapi import HTTPException, Header, status
from typing import Optional
import uuid
import base64
import logging

from backend.services.user_service import user_service
from backend.services.file_service import file_service
from backend.services.audit_service import AuditService
from backend.services.event_service import event_service
from backend.services.tus_metadata_store import TusMetadataStore
from backend.config import settings
from backend.services.token_service import token_service
from backend.core.rate_limit import limiter 

from fastapi import BackgroundTasks
import os
import aiofiles

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api")

# TUS Protocol Constants
TUS_VERSION = "1.0.0"
CHUNK_SIZE = 5 * 1024 * 1024  # 5MB chunks (aligned with R2 Multipart)

# Initialize services
metadata_store = TusMetadataStore()
audit_service = AuditService(os.path.join(settings.paths.user_info_file.parent, "audit_logs.json"))
# event_service imported as singleton


def parse_tus_metadata(metadata_header: Optional[str]) -> dict:
    """Parse TUS Upload-Metadata header (Base64-encoded key-value pairs)."""
    if not metadata_header:
        return {}
    
    result = {}
    for pair in metadata_header.split(','):
        pair = pair.strip()
        if ' ' not in pair:
            continue
        key, value = pair.split(' ', 1)
        try:
            decoded = base64.b64decode(value).decode('utf-8')
            result[key] = decoded
        except Exception as e:
            logger.warning(f"Failed to decode metadata {key}: {e}")
    
    return result


def calculate_fingerprint(filename: str, size: int, modified: Optional[str] = None) -> str:
    """Calculate file fingerprint for resume detection (matches Uppy's logic)."""
    parts = [filename, str(size)]
    if modified:
        parts.append(modified)
    return '-'.join(parts)





async def finalize_upload_local(upload: dict):
    """Finalize upload: move from temp to user folder, notify."""
    upload_id = upload['id']
    username = upload['username']
    filename = upload['filename']
    
    logger.info(f"Finalizing Local TUS upload {upload_id} for user {username}...")
    
    try:
        # 1. Path to temp file
        temp_path = settings.paths.tus_temp_folder / upload_id
        
        if not temp_path.exists():
             logger.error(f"Temp file not found: {temp_path}")
             return

        # 2. Import to user folder (dedup & move)
        # This is an instant move on same filesystem
        final_name = await file_service.import_file(temp_path, username, filename)
        
        if not final_name:
            logger.error(f"Failed to import file to user folder: {filename}")
            return
            
        logger.info(f"File imported successfully as: {final_name}")

        # 3. Notify & Audit
        await audit_service.log_event(
            username, 
            "FILE_UPLOAD_TUS", 
            f"TUS Upload completed (Local): {final_name}", 
            ip="TUS_LOCAL"
        )
        await event_service.notify_user_update(username)
        
    except Exception as e:
        logger.error(f"Error in finalize_upload_local for {upload_id}: {e}")



@router.post("/upload/tus")
@limiter.limit(settings.rate_limit.tus_limit)
async def create_tus_upload(
    request: Request,
    upload_length: int = Header(..., alias="Upload-Length"),
    upload_metadata: Optional[str] = Header(None, alias="Upload-Metadata"),
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable")
):
    """TUS POST - Create new upload or return existing one for resume."""
    try:
        # Parse metadata
        metadata = parse_tus_metadata(upload_metadata)
        filename = metadata.get('filename', 'unnamed')
        content_type = metadata.get('filetype', 'application/octet-stream')
        password = metadata.get('password')
        token = metadata.get('token')
        
        # Authenticate
        user = None
        if token:
            # Only owner (session/access) tokens may upload; share tokens may not.
            owner = token_service.owner_username(token)
            if owner:
                user = await user_service.get_user_by_name(owner)
        
        if not user and password:
            user = await user_service.get_user_by_password(password)
            
        if not user:
            raise HTTPException(status_code=401, detail="驗證失敗")
        
        # Calculate fingerprint
        fingerprint = calculate_fingerprint(filename, upload_length, metadata.get('lastModified'))
        logger.info(f"TUS Create: fingerprint={fingerprint}, size={upload_length}, user={user['username']}")
        
        # Check for existing upload (resume)
        existing = metadata_store.get_upload_by_fingerprint(fingerprint, user['username'])
        
        if existing and existing['status'] == 'active':
            logger.info(f"TUS Resume: Found existing upload {existing['id']}, offset={existing['offset']}")
            return Response(
                status_code=200,
                headers={
                    "Location": f"{request.base_url}api/upload/tus/{existing['id']}",
                    "Tus-Resumable": TUS_VERSION,
                    "Upload-Offset": str(existing['offset']),
                    "Content-Length": "0"
                }
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
            raise HTTPException(status_code=500, detail="Failed to initialize upload storage")

        # Store metadata
        created = metadata_store.create_upload(
            upload_id=upload_id,
            fingerprint=fingerprint,
            username=user['username'],
            size=upload_length,
            filename=filename,
            content_type=content_type,
            metadata=metadata
        )
        
        if not created:
             # Cleanup
             file_path.unlink(missing_ok=True)
             raise HTTPException(status_code=500, detail="Failed to create upload session")
            
        logger.info(f"Created Local TUS upload: {upload_id} for {filename}")
        
        return Response(
            status_code=status.HTTP_201_CREATED,
            headers={
                "Location": f"{request.base_url}api/upload/tus/{upload_id}",
                "Tus-Resumable": TUS_VERSION,
                "Upload-Offset": "0",
                "Content-Length": "0"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"TUS Create Error: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


@router.head("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def get_tus_upload_offset(
    request: Request,
    upload_id: str,
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable")
):
    """TUS HEAD - Get current upload offset."""
    upload = metadata_store.get_upload(upload_id)
    
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    
    return Response(
        status_code=200,
        headers={
            "Tus-Resumable": TUS_VERSION,
            "Upload-Offset": str(upload['offset']),
            "Upload-Length": str(upload['size']),
            "Cache-Control": "no-store",
            "Content-Length": "0"
        }
    )


@router.patch("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def upload_tus_chunk(
    upload_id: str,
    request: Request,
    background_tasks: BackgroundTasks,
    upload_offset: int = Header(..., alias="Upload-Offset"),
    content_length: int = Header(..., alias="Content-Length"),
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable")
):
    """TUS PATCH - Upload a chunk of data."""
    upload = metadata_store.get_upload(upload_id)
    
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    
    # Verify offset
    current_offset = upload['offset']
    if upload_offset != current_offset:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Offset mismatch. Expected {current_offset}, got {upload_offset}"
        )
        
    # File path
    file_path = settings.paths.tus_temp_folder / upload_id
    if not file_path.exists():
         raise HTTPException(status_code=404, detail="Upload file not found on server")

    # Read chunk
    try:
        chunk = await request.body()
    except ClientDisconnect:
        logger.warning(f"Client disconnected during upload of {upload_id}")
        return Response(status_code=499) # Client Closed Request

    chunk_size = len(chunk)
    
    # Check strict size
    if current_offset + chunk_size > upload['size']:
         raise HTTPException(status_code=400, detail="Upload exceeds total size")

    # Append to file
    try:
        async with aiofiles.open(file_path, 'ab') as f:
            await f.write(chunk)
    except Exception as e:
        logger.error(f"Write error for {upload_id}: {e}")
        raise HTTPException(status_code=500, detail="Failed to write chunk")

    # Update metadata
    new_offset = current_offset + chunk_size
    metadata_store.update_offset(upload_id, new_offset, parts=[]) # Parts no longer needed for local
    
    logger.info(f"TUS Chunk {upload_id}: +{chunk_size} bytes, new_offset={new_offset}")

    # Complete if done
    if new_offset == upload['size']:
        logger.info(f"TUS Complete (Local): {upload_id}")
        metadata_store.mark_completed(upload_id)
        # Trigger finalization (can be awaited or background, strictly speaking instant move is fast enough)
        background_tasks.add_task(finalize_upload_local, upload)
    
    return Response(
        status_code=status.HTTP_204_NO_CONTENT,
        headers={
            "Upload-Offset": str(new_offset),
            "Tus-Resumable": TUS_VERSION
        }
    )


@router.delete("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def cancel_tus_upload(
    request: Request,
    upload_id: str,
    tus_resumable: str = Header(TUS_VERSION, alias="Tus-Resumable")
):
    """TUS DELETE - Cancel upload and clean up."""
    upload = metadata_store.get_upload(upload_id)
    
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    
    logger.info(f"TUS Delete: upload_id={upload_id}")
    
    # Abort local upload
    metadata_store.mark_aborted(upload_id)
    
    file_path = settings.paths.tus_temp_folder / upload_id
    if file_path.exists():
        try:
            file_path.unlink()
            logger.info(f"Deleted temp file for aborted upload: {upload_id}")
        except Exception as e:
            logger.error(f"Failed to delete temp file: {e}")
    
    return Response(
        status_code=204,
        headers={"Tus-Resumable": TUS_VERSION}
    )


def cleanup_expired_uploads():
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
            logger.info(f"Cleaned up {len(expired_ids)} stale uploads and {count} files.")
            
    except Exception as e:
        logger.error(f"Cleanup error: {e}")


@router.options("/upload/tus")
@router.options("/upload/tus/{upload_id}")
@limiter.limit(settings.rate_limit.tus_limit)
async def tus_options(request: Request):
    """TUS OPTIONS - Advertise server capabilities."""
    return Response(
        status_code=204,
        headers={
            "Tus-Resumable": TUS_VERSION,
            "Tus-Version": TUS_VERSION,
            "Tus-Extension": "creation,termination",
            # "Tus-Max-Size": str(10 * 1024 * 1024 * 1024),  # 10GB - REMOVED for clarity
        }
    )
