"""FCM integration tests with real credentials and a mocked HTTP transport."""

import asyncio
import importlib.util
import json
import logging
from pathlib import Path
from typing import Any

import httpx
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from fastapi.testclient import TestClient

from backend.services.database import get_users_db
from backend.services.user_service import user_service
from backend.tests.test_devices import account, bearer, device_row, metadata, register


@pytest.fixture()
def service_account_file(tmp_path: Path) -> Path:
    """Write throwaway signing credentials for the real google-auth flow."""
    private_key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = private_key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()).decode()
    path = tmp_path / "service-account.json"
    path.write_text(json.dumps({"type": "service_account", "project_id": "test-project", "private_key_id": "test-key", "private_key": pem, "client_email": "test@test-project.iam.gserviceaccount.com", "token_uri": "https://oauth2.googleapis.com/token"}))
    return path


@pytest.mark.parametrize("failure", ["404", "unregistered", "server", "timeout"])
def test_push_debounce_exclusion_cleanup(client: TestClient, account: dict[str, Any], service_account_file: Path, failure: str, caplog: pytest.LogCaptureFixture) -> None:
    """Batch uploads, exclude their origin, and clear only stale FCM tokens."""
    assert importlib.util.find_spec("backend.services.push_service") is not None, "FCM service is not implemented"
    from backend.services.push_service import PushService
    source = register(client, account, push_token="source")
    target = register(client, account, push_token="target")
    broken = register(client, account, push_token="broken")
    register(client, account, platform="ios", push_token="ios")
    revoked = register(client, account, push_token="revoked")
    assert client.delete(f"/api/devices/{revoked['device_id']}", headers=bearer(revoked["device_token"])).status_code == 200
    other_name = f"other-{source['device_id']}"
    client.portal.call(user_service.create_user, other_name, f"password-{other_name}")
    register(client, {"password": f"password-{other_name}"}, push_token="other")
    requests: list[dict[str, Any]] = []
    oauth_requests: list[httpx.Request] = []
    def transport(request: httpx.Request) -> httpx.Response:
        """Serve OAuth and FCM responses at the HTTP boundary only."""
        assert request.extensions["timeout"]["read"] is not None
        if request.url.host == "oauth2.googleapis.com":
            oauth_requests.append(request)
            assert b"assertion=" in request.content
            return httpx.Response(200, json={"access_token": "oauth-access", "expires_in": 3600, "token_type": "Bearer"})
        assert str(request.url) == "https://fcm.googleapis.com/v1/projects/test-project/messages:send"
        assert request.headers["Authorization"] == "Bearer oauth-access"
        message = json.loads(request.content)["message"]
        requests.append(message)
        if message["token"] == "broken":
            if failure == "timeout":
                raise httpx.ReadTimeout("FCM timeout", request=request)
            if failure == "server":
                return httpx.Response(500, json={"error": {"status": "INTERNAL"}})
            status = 404 if failure == "404" else 400
            return httpx.Response(status, json={"error": {"details": [{"@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", "errorCode": "UNREGISTERED"}]}})
        return httpx.Response(200, json={"name": "projects/test-project/messages/1"})
    async def exercise() -> None:
        """Run actual timer tasks and OAuth refresh in the app event loop."""
        service = PushService(service_account_file, debounce_seconds=0.02, transport=httpx.MockTransport(transport))
        service.startup()
        service.schedule_files_added(account["username"], source["device_id"], count=1)
        service.schedule_files_added(account["username"], source["device_id"], count=2)
        await service.wait_pending()
        await service.shutdown()
    with caplog.at_level(logging.DEBUG):
        client.portal.call(exercise)
    assert len(oauth_requests) == 1
    assert {message["token"] for message in requests} == {"target", "broken"}
    assert len(requests) == 2
    for message in requests:
        assert message["data"] == {"type": "files_added", "username": account["username"], "count": "3"}
        assert message["notification"]["title"] == "新增檔案"
        assert "3" in message["notification"]["body"]
    row = client.portal.call(device_row, broken["device_id"])
    assert row["push_token"] == (None if failure in {"404", "unregistered"} else "broken")
    if failure in {"server", "timeout"}:
        assert any(record.levelno == logging.ERROR and record.exc_info for record in caplog.records)
    assert client.portal.call(device_row, target["device_id"])["push_token"] == "target"


def test_disabled_push_warns_once(client: TestClient, caplog: pytest.LogCaptureFixture) -> None:
    """Missing configuration warns once and sends remain debug-level no-ops."""
    assert importlib.util.find_spec("backend.services.push_service") is not None, "FCM service is not implemented"
    from backend.services.push_service import PushService
    async def exercise() -> None:
        """Use the unconfigured service without making network requests."""
        service = PushService(None)
        service.startup()
        service.startup()
        service.schedule_files_added("nobody", None)
        await service.wait_pending()
        await service.shutdown()
    with caplog.at_level(logging.DEBUG):
        client.portal.call(exercise)
    warnings = [record for record in caplog.records if record.levelno == logging.WARNING and "push" in record.name]
    assert len(warnings) == 1
    assert any(record.levelno == logging.DEBUG and "push" in record.name for record in caplog.records)


@pytest.mark.parametrize("upload_kind", ["legacy", "tus"])
def test_upload_schedules_real_push(client: TestClient, account: dict[str, Any], service_account_file: Path, upload_kind: str) -> None:
    """Upload completion feeds the running push singleton without mocking it."""
    assert importlib.util.find_spec("backend.services.push_service") is not None, "FCM service is not implemented"
    from backend.services.push_service import push_service
    source = register(client, account, push_token="source")
    register(client, account, push_token="receiver")
    requests: list[dict[str, Any]] = []
    def transport(request: httpx.Request) -> httpx.Response:
        """Answer only the OAuth/FCM network boundary."""
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "oauth-access", "expires_in": 3600, "token_type": "Bearer"})
        requests.append(json.loads(request.content)["message"])
        return httpx.Response(200, json={"name": "ok"})
    async def configure() -> None:
        """Configure the production singleton for this HTTP integration test."""
        push_service.service_account_file = service_account_file
        push_service.transport = httpx.MockTransport(transport)
        push_service.debounce_seconds = 0.02
        push_service.startup()
    client.portal.call(configure)
    try:
        if upload_kind == "legacy":
            response = client.post("/api/upload", data={"token": source["device_token"]}, files={"files": ("legacy-push.jpg", b"photo")})
            assert response.status_code == 200
        else:
            response = client.post("/api/upload/tus", headers={"Upload-Length": "5", "Upload-Metadata": metadata(filename="tus-push.jpg", token=source["device_token"])})
            assert response.status_code == 201
            assert client.patch(response.headers["Location"], content=b"photo", headers={"Upload-Offset": "0", **bearer(source["device_token"])}).status_code == 204
        client.portal.call(push_service.wait_pending)
        assert len(requests) == 1
        assert requests[0]["token"] == "receiver"
        assert requests[0]["data"]["count"] == "1"
    finally:
        client.portal.call(push_service.shutdown)
        push_service.service_account_file = None
        push_service.transport = None
        push_service.debounce_seconds = 30.0
        client.portal.call(push_service.startup)
