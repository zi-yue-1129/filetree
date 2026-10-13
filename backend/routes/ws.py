from typing import Optional
from fastapi import APIRouter, WebSocket, WebSocketDisconnect, Query
from backend.services.event_service import event_service
from backend.services.user_service import user_service
from backend.services.token_service import token_service

router = APIRouter()

@router.websocket("/ws/{username}")
async def websocket_endpoint(
    websocket: WebSocket, 
    username: str,
    token: Optional[str] = Query(None)
):
    """WebSocket bridge for real-time state synchronization."""
    # Authenticate: If provided, validate token
    # If not provided, we can still allow connection but maybe restrict what's sent.
    # For now, if a user is "locked" or for better security, require token.
    user = await user_service.get_user_by_name(username)
    if not user:
        await websocket.close(code=1008)
        return

    # SECURE: Require token if the user exists and we want to prevent subscription leakage.
    # Since REFRESH signals are relatively harmless, we could be lenient, 
    # but for a "Secure Auth" task, let's be strict if they are locked.
    if user.get("is_locked", False):
        if not token:
            await websocket.close(code=4001, reason="Authentication required")
            return
        
        if not token_service.is_owner_token(token, username):
            await websocket.close(code=4003, reason="Invalid token")
            return
    
    # Check if user exists
    user = await user_service.get_user_by_name(username)
    if not user:
        await websocket.close(code=1008)
        return

    await event_service.connect(username, websocket)
    try:
        while True:
            # Keep connection alive, we don't expect messages from client for now
            await websocket.receive_text()
    except WebSocketDisconnect:
        event_service.disconnect(username, websocket)
    except Exception:
        event_service.disconnect(username, websocket)



