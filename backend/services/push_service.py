"""Debounced Android FCM delivery isolated from upload request failures."""

import asyncio
import logging
from collections import Counter
from pathlib import Path
from typing import Any, Mapping, Optional

import httpx
from google.auth.transport import Request as GoogleRequest
from google.auth.transport import Response as GoogleResponse
from google.oauth2 import service_account

from backend.config import settings
from backend.services.database import get_users_db

logger = logging.getLogger(__name__)
FCM_SCOPE = "https://www.googleapis.com/auth/firebase.messaging"
HTTP_TIMEOUT = 10.0


class OAuthResponse(GoogleResponse):
    """Adapt an httpx response to google-auth's transport interface."""

    def __init__(self, response: httpx.Response) -> None:
        """Retain the OAuth HTTP response.

        Args:
            response: Response received by the OAuth transport.
        """
        self.response = response

    @property
    def status(self) -> int:
        """Return the OAuth HTTP status code."""
        return self.response.status_code

    @property
    def data(self) -> bytes:
        """Return the OAuth response body."""
        return self.response.content

    @property
    def headers(self) -> Mapping[str, str]:
        """Return the OAuth response headers."""
        return self.response.headers


class OAuthRequest(GoogleRequest):
    """Use explicit-timeout httpx requests for google-auth token refresh."""

    def __init__(self, transport: Optional[httpx.BaseTransport]) -> None:
        """Configure an optional synchronous HTTP transport.

        Args:
            transport: HTTP transport override, or default networking.
        """
        self.transport = transport

    def __call__(
        self,
        url: str,
        method: str = "GET",
        body: Optional[bytes] = None,
        headers: Optional[Mapping[str, str]] = None,
        timeout: Optional[float] = HTTP_TIMEOUT,
        **kwargs: Any,
    ) -> OAuthResponse:
        """Perform a bounded OAuth request for google-auth.

        Args:
            url: OAuth token endpoint.
            method: HTTP method.
            body: Signed authorization grant.
            headers: OAuth request headers.
            timeout: Caller timeout, bounded to the service maximum.
            **kwargs: Additional google-auth transport options.

        Returns:
            Adapted OAuth response.
        """
        bounded_timeout = (
            min(timeout, HTTP_TIMEOUT) if timeout is not None else HTTP_TIMEOUT
        )
        with httpx.Client(timeout=bounded_timeout, transport=self.transport) as client:
            return OAuthResponse(
                client.request(method, url, content=body, headers=headers)
            )


class PushService:
    """Batch per-account file events and deliver recipient-specific FCM pushes."""

    def __init__(
        self,
        service_account_file: Optional[Path],
        debounce_seconds: float = 30.0,
        transport: Optional[httpx.AsyncBaseTransport] = None,
        oauth_transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        """Configure delivery without initiating network calls.

        Args:
            service_account_file: Optional FCM service-account JSON path.
            debounce_seconds: Per-user aggregation window.
            transport: Optional FCM HTTP transport.
            oauth_transport: Optional synchronous OAuth HTTP transport.
        """
        self.service_account_file = service_account_file
        self.debounce_seconds = debounce_seconds
        self.transport = transport
        self.oauth_transport = oauth_transport
        self.credentials: Optional[service_account.Credentials] = None
        self._warned_disabled = False
        self._refresh_lock = asyncio.Lock()
        self._pending: dict[str, Counter[Optional[str]]] = {}
        self._tasks: set[asyncio.Task[None]] = set()

    def startup(self) -> None:
        """Load credentials or emit one warning for disabled configuration."""
        self.credentials = None
        if self.service_account_file is None:
            if not self._warned_disabled:
                logger.warning(
                    "FCM push disabled: PUSH__FCM_SERVICE_ACCOUNT_FILE is not configured"
                )
                self._warned_disabled = True
            return
        try:
            self.credentials = service_account.Credentials.from_service_account_file(
                str(self.service_account_file),
                scopes=[FCM_SCOPE],
            )
            if not self.credentials.project_id:
                raise ValueError("FCM service account must include project_id")
        except Exception:
            self.credentials = None
            logger.error("Failed to initialize FCM service account", exc_info=True)

    def schedule_files_added(
        self,
        username: str,
        device_id: Optional[str],
        count: int = 1,
    ) -> None:
        """Enqueue an event without waiting for network delivery.

        Args:
            username: Account receiving the uploaded files.
            device_id: Uploading registration, or None for a web upload.
            count: Successfully added file count.
        """
        if count <= 0:
            return
        if self.credentials is None:
            logger.debug("FCM push disabled; ignoring files_added for %s", username)
            return
        try:
            batch = self._pending.get(username)
            if batch is not None:
                batch[device_id] += count
                return
            self._pending[username] = Counter({device_id: count})
            task = asyncio.create_task(self._deliver_after_delay(username))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        except Exception:
            self._pending.pop(username, None)
            logger.error(
                "Failed to schedule FCM files_added for %s", username, exc_info=True
            )

    async def _deliver_after_delay(self, username: str) -> None:
        """Wait for the batch window, then deliver without leaking failures."""
        try:
            await asyncio.sleep(self.debounce_seconds)
            batch = self._pending.pop(username)
            await self._send_batch(username, batch)
        except asyncio.CancelledError:
            self._pending.pop(username, None)
            raise
        except Exception:
            logger.error(
                "Failed to deliver FCM files_added for %s", username, exc_info=True
            )

    async def _access_token(self) -> str:
        """Refresh OAuth off the event loop and reuse valid access credentials."""
        if self.credentials is None:
            raise RuntimeError("FCM credentials are not initialized")
        async with self._refresh_lock:
            if not self.credentials.valid:
                transport = self.oauth_transport
                if transport is None and isinstance(
                    self.transport, httpx.BaseTransport
                ):
                    transport = self.transport
                await asyncio.to_thread(
                    self.credentials.refresh, OAuthRequest(transport)
                )
            if not self.credentials.token:
                raise RuntimeError("OAuth refresh did not return an access token")
            return self.credentials.token

    async def _send_batch(self, username: str, batch: Counter[Optional[str]]) -> None:
        """Send counts excluding each recipient's own uploaded files."""
        database = await get_users_db()
        cursor = await database.execute(
            "SELECT d.id, d.push_token FROM devices d JOIN users u ON d.user_id = u.id "
            "WHERE u.username = ? AND d.platform = 'android' AND d.revoked_at IS NULL "
            "AND d.push_token IS NOT NULL AND d.push_token != ''",
            (username,),
        )
        devices = await cursor.fetchall()
        recipients = [
            (device, sum(batch.values()) - batch[device["id"]]) for device in devices
        ]
        recipients = [(device, count) for device, count in recipients if count > 0]
        if not recipients:
            return
        token = await self._access_token()
        if self.credentials is None:
            raise RuntimeError("FCM credentials disappeared during delivery")
        url = f"https://fcm.googleapis.com/v1/projects/{self.credentials.project_id}/messages:send"
        async with httpx.AsyncClient(
            timeout=HTTP_TIMEOUT, transport=self.transport
        ) as client:
            for device, count in recipients:
                try:
                    response = await client.post(
                        url,
                        headers={"Authorization": f"Bearer {token}"},
                        json={
                            "message": {
                                "token": device["push_token"],
                                "data": {
                                    "type": "files_added",
                                    "username": username,
                                    "count": str(count),
                                },
                                "notification": {
                                    "title": "新增檔案",
                                    "body": f"您的帳號新增了 {count} 個檔案",
                                },
                            },
                        },
                    )
                    if response.status_code == 404 or self._is_unregistered(response):
                        await database.execute(
                            "UPDATE devices SET push_token = NULL WHERE id = ? AND push_token = ?",
                            (device["id"], device["push_token"]),
                        )
                        await database.commit()
                        continue
                    response.raise_for_status()
                except Exception:
                    logger.error(
                        "FCM delivery failed for device %s", device["id"], exc_info=True
                    )

    @staticmethod
    def _is_unregistered(response: httpx.Response) -> bool:
        """Identify the structured FCM error without treating all 400s as stale."""
        if response.is_success:
            return False
        payload = response.json()
        error = payload.get("error", {})
        return any(
            detail.get("errorCode") == "UNREGISTERED"
            for detail in error.get("details", [])
        )

    async def wait_pending(self) -> None:
        """Wait for currently scheduled delivery tasks during a graceful drain."""
        while self._tasks:
            await asyncio.gather(*tuple(self._tasks))

    async def shutdown(self) -> None:
        """Cancel pending timers and drain tasks before database shutdown."""
        tasks = tuple(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        self._pending.clear()


push_service = PushService(settings.push.fcm_service_account_file)
