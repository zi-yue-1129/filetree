"""
FastAPI router for all FileNexus API endpoints.
Aggregates sub-routers for auth, users, files, admin, and websockets.
Refactored from monolithic api.py.
"""

from fastapi import APIRouter

from backend.routes import admin, auth, devices, files, folders, users, ws

# Create the main API router with /api prefix
router = APIRouter(prefix="/api")

# Include sub-routers
# Tags are used for OpenAPI documentation grouping
router.include_router(auth.router, tags=["Authentication"])
router.include_router(users.router, tags=["Users"])
router.include_router(files.router, tags=["Files"])
router.include_router(admin.router, tags=["Admin"])
router.include_router(ws.router, tags=["WebSockets"])

router.include_router(devices.router, tags=["Devices"])
router.include_router(folders.router, tags=["Folders"])
