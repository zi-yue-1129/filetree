"""
Main FastAPI entry point for the FileNexus application.
"""

import os
import sys
import asyncio
from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.middleware.cors import CORSMiddleware
from backend.config import settings
from backend.core.compression import ApiGZipMiddleware
from backend.routes.api import router as api_router
from backend.routes.tus import router as tus_router
from backend.routes.tus import cleanup_expired_uploads
from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional
from starlette.concurrency import run_in_threadpool
import logging

logger = logging.getLogger(__name__)

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Initialize storage and push delivery, then close them on shutdown."""
    # Startup: Initialize databases
    from backend.services.database import init_db, close_all
    from backend.services.file_service import file_service
    from backend.services.push_service import push_service
    push_service.startup()
    logger.info("Startup: Initializing databases...")
    await init_db()
    from backend.services.token_service import token_service
    await run_in_threadpool(token_service.load)

    # Startup: Reconcile disk ↔ DB
    logger.info("Startup: Reconciling file index...")
    stats = await file_service.reconcile_all_users()
    logger.info(f"Reconciliation: {stats}")

    # Startup: Run cleanup immediately
    try:
        logger.info("Startup: Running stale upload cleanup...")
        await run_in_threadpool(cleanup_expired_uploads)
    except Exception as e:
        logger.error(f"Startup cleanup failed: {e}")

    # Start periodic background task
    async def periodic_cleanup() -> None:
        """Clean stale upload sessions until application shutdown."""
        while True:
            await asyncio.sleep(36000)  # Run every 10 hour
            try:
                logger.info("Periodic: Running stale upload cleanup...")
                await run_in_threadpool(cleanup_expired_uploads)
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Periodic cleanup failed: {e}")

    cleanup_task = asyncio.create_task(periodic_cleanup())
    from backend.services.backup_service import start_backup_task
    backup_task = start_backup_task(settings.backup)

    yield

    # Shutdown: Cancel cleanup and backup tasks
    cleanup_task.cancel()
    await asyncio.gather(cleanup_task, return_exceptions=True)
    if backup_task is not None:
        backup_task.cancel()
        await asyncio.gather(backup_task, return_exceptions=True)

    await push_service.shutdown()
    from backend.routes.tus import metadata_store
    await run_in_threadpool(metadata_store.close)

    # Shutdown: Close database connections
    await close_all()


def suppress_connection_reset_error(
    loop: asyncio.AbstractEventLoop, context: dict[str, Any]
) -> None:
    """Custom exception handler to suppress ConnectionResetError on Windows."""
    exception = context.get("exception")
    if isinstance(exception, (ConnectionResetError, ConnectionAbortedError)):
        # Silently ignore ConnectionResetError (WinError 10054) and similar
        return
    # For all other exceptions, use the default handler
    loop.default_exception_handler(context)


def apply_windows_patches() -> None:
    """Apply monkey-patches to asyncio for Windows to suppress specific errors."""
    if sys.platform == "win32":
        try:
            from asyncio.proactor_events import _ProactorBasePipeTransport
            import socket

            # Backup the original method
            orig_call_connection_lost = _ProactorBasePipeTransport._call_connection_lost

            def patched_call_connection_lost(self: Any, exc: Optional[BaseException]) -> None:
                """Handle expected Windows transport shutdown errors."""
                try:
                    orig_call_connection_lost(self, exc)
                except (ConnectionResetError, ConnectionAbortedError):
                    # Suppress the error during shutdown or connection loss
                    return
                except socket.error as e:
                    # Capture specific WinError 10054 or 10038
                    if getattr(e, "winerror", None) in (10054, 10038):
                        return
                    else:
                        raise

            # Apply the monkey-patch
            _ProactorBasePipeTransport._call_connection_lost = patched_call_connection_lost
            logger.info("Windows-specific asyncio patches applied.")
        except (ImportError, AttributeError) as e:
            logger.debug(f"Could not apply Windows patches: {e}")


# Apply patches immediately during module load
apply_windows_patches()


from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from backend.core.rate_limit import limiter


app = FastAPI(
    title="FileNexus API",
    description="High-performance file management backend with FastAPI",
    version="2.2.0",
    lifespan=lifespan
)

# Set up Rate Limiter
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(ApiGZipMiddleware)
app.add_middleware(SlowAPIMiddleware)

# Enable CORS for security and cross-origin support
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.server.cors_origins, 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=[
        "Tus-Resumable", 
        "Tus-Version", 
        "Tus-Extension", 
        "Tus-Max-Size", 
        "Upload-Offset", 
        "Upload-Length", 
        "Upload-Metadata", 
        "Location",
        "Content-Length",
        "ETag",
        "Cache-Control",
        "Content-Range",
        "Accept-Ranges",
        "Authorization" # Ensure Bearer tokens can be handled
    ]
)

# Include API routes
# TUS router MUST be registered FIRST to prevent conflicts with old TUS endpoints in api.py
app.include_router(tus_router)  # TUS resumable upload endpoints (NEW)
app.include_router(api_router)  # Legacy routes (contains old TUS endpoints - commented out)

# Serve the React build (SPA)
# 1. First, try to serve specific files from static/dist
# 2. If no file matches, serve index.html (SPA routing)

# Check if static dir exists
static_path = settings.paths.static_dir
if not static_path.exists():
    print(f"Warning: Static directory {static_path} not found. Build the frontend first.")

# WebSocket endpoint for global events - defined directly on app to bypass router issues
from fastapi import WebSocket, WebSocketDisconnect
from backend.services.event_service import event_service

@app.websocket("/ws/global")
async def global_websocket_endpoint(websocket: WebSocket) -> None:
    """Global WebSocket for system-wide updates (e.g. user list)."""
    # Optional: We could check a handshake token here for stricter security
    # await websocket.accept()
    # But for now, we just connect.
    await event_service.connect_global(websocket)
    try:
        while True:
            await websocket.receive_text()
    except WebSocketDisconnect:
        event_service.disconnect_global(websocket)
    except Exception:
        event_service.disconnect_global(websocket)

@app.get("/{path:path}")
async def serve_spa(request: Request, path: str) -> Any:
    """Serve the SPA or static assets."""
    # Serve a real file only if it resolves inside static_dir; this blocks
    # traversal via encoded "../" segments or absolute paths (e.g. "%2Fetc").
    if "\x00" not in path:
        static_root = static_path.resolve()
        file_path = (static_root / path.lstrip("/")).resolve()
        if file_path.is_relative_to(static_root) and file_path.is_file():
            return FileResponse(file_path)
    
    # Otherwise, return index.html for SPA routing
    # IMPORTANT: no-cache for index.html to prevent stale JS bundle references
    index_path = static_path / "index.html"
    if index_path.exists():
        if path.startswith("share/"):
            try:
                token = path.rstrip("/").split("/")[-1]
                from backend.services.token_service import token_service
                info = token_service.validate_token(token)
                if info:
                    from backend.services.user_service import user_service
                    from backend.services.database import get_files_db
                    import mimetypes
                    import re

                    user = await user_service.get_user_by_name(info.username)
                    if user:
                        db = await get_files_db()
                        cursor = await db.execute(
                            "SELECT size_bytes FROM files WHERE username = ? AND filename = ?",
                            (user["folder"], info.filename),
                        )
                        row = await cursor.fetchone()
                        size_str = ""
                        if row:
                            sb = row["size_bytes"]
                            sm = round(sb / (1024 * 1024), 2)
                            size_str = f"{sm} MB" if sm >= 0.1 else f"{round(sb/1024, 2)} KB"
                        
                        title = f"分享檔案: {info.filename}"
                        description = f"來自 @{info.username} 的分享 | 大小: {size_str}"
                        # Need absolute URL for social previews
                        base = str(request.base_url).rstrip("/")
                        image_url = f"{base}/api/thumbnail/{info.username}/{info.filename}?token={token}"
                        video_url = f"{base}/api/download/{info.username}/{info.filename}?token={token}&inline=true"
                        
                        mime_type, _ = mimetypes.guess_type(info.filename)
                        is_video = mime_type and mime_type.startswith("video")

                        with open(index_path, "r", encoding="utf-8") as f:
                            content = f.read()
                        
                        logger.info(f"Injecting meta tags for token: {token} | Video: {is_video}")
                        
                        # Use loose regex to match tags regardless of attribute order or newlines
                        content = re.sub(r'<title>.*?</title>', f'<title>{title}</title>', content, flags=re.DOTALL)
                        content = re.sub(r'<meta[^>]*name=["\']description["\'][^>]*>', f'<meta name="description" content="{description}" />', content, flags=re.DOTALL | re.IGNORECASE)
                        content = re.sub(r'<meta[^>]*property=["\']og:title["\'][^>]*>', f'<meta property="og:title" content="{title}" />', content, flags=re.DOTALL | re.IGNORECASE)
                        content = re.sub(r'<meta[^>]*property=["\']og:description["\'][^>]*>', f'<meta property="og:description" content="{description}" />', content, flags=re.DOTALL | re.IGNORECASE)
                        content = re.sub(r'<meta[^>]*property=["\']og:image["\'][^>]*>', f'<meta property="og:image" content="{image_url}" />', content, flags=re.DOTALL | re.IGNORECASE)

                        if is_video:
                            # Replace og:type and add video tags
                            content = re.sub(r'<meta[^>]*property=["\']og:type["\'][^>]*>', 
                                           f'<meta property="og:type" content="video.other" />\n    <meta property="og:video" content="{video_url}" />\n    <meta property="og:video:type" content="{mime_type}" />', 
                                           content, flags=re.DOTALL | re.IGNORECASE)
                        
                        return HTMLResponse(content=content, headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
                else:
                    logger.warning(f"Meta injection: Token {token} not found or expired")
            except Exception as e:
                logger.error(f"Meta injection failed: {e}")

        return FileResponse(
            index_path,
            headers={"Cache-Control": "no-cache, no-store, must-revalidate"}
        )
    
    return {"detail": "Not Found"}

if __name__ == "__main__":
    import uvicorn
    
    # Init loop with custom exception handler
    try:
        loop = asyncio.get_event_loop()
    except RuntimeError:
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
    
    loop.set_exception_handler(suppress_connection_reset_error)
    
    uvicorn.run(
        "backend.app:app",
        host=settings.server.host,
        port=settings.server.port,
        reload=settings.server.debug,
        timeout_graceful_shutdown=0,  # Force immediate shutdown
        timeout_keep_alive=60  # Enable keep-alive for TUS
    )
