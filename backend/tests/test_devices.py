"""Native device credentials, scoped management, and upload placement tests."""

import base64
import hashlib
import json
import uuid
from typing import Any

import pytest
from fastapi import HTTPException, WebSocketDisconnect
from fastapi.testclient import TestClient

from backend.config import settings
from backend.core.auth import get_current_user_token, verify_ownership
from backend.services.database import get_files_db, get_users_db, init_db
from backend.services.event_service import event_service
from backend.services.token_service import token_service
from backend.services.user_service import user_service


def register(
    client: TestClient, account: dict[str, Any], **fields: Any
) -> dict[str, str]:
    """Register a real device through its public JSON endpoint."""
    response = client.post(
        "/api/devices/register",
        json={
            "password": account["password"],
            "device_name": "Pixel",
            "platform": "android",
            **fields,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def bearer(token: str) -> dict[str, str]:
    """Construct a bearer credential header."""
    return {"Authorization": f"Bearer {token}"}


def metadata(**fields: str) -> str:
    """Encode protocol metadata without mocking the upload implementation."""
    return ",".join(
        f"{key} {base64.b64encode(value.encode()).decode()}"
        for key, value in fields.items()
    )


async def device_row(device_id: str) -> dict[str, Any]:
    """Read the persisted device row for storage assertions."""
    database = await get_users_db()
    cursor = await database.execute("SELECT * FROM devices WHERE id = ?", (device_id,))
    row = await cursor.fetchone()
    assert row is not None
    return dict(row)


@pytest.mark.parametrize("encoding", ["json", "form"])
def test_register_persists_only_hash(
    client: TestClient, account: dict[str, Any], encoding: str
) -> None:
    """Registration accepts either encoding and never persists the raw credential."""
    fields = {
        "password": account["password"],
        "device_name": "Phone",
        "platform": "android",
    }
    response = client.post(
        "/api/devices/register", **{encoding if encoding == "json" else "data": fields}
    )
    assert response.status_code == 200, response.text
    result = response.json()
    assert set(result) == {"device_id", "device_token", "username"}
    assert result["username"] == account["username"]
    assert len(base64.urlsafe_b64decode(result["device_token"] + "==")) >= 32
    row = client.portal.call(device_row, result["device_id"])
    assert (
        row["token_hash"] == hashlib.sha256(result["device_token"].encode()).hexdigest()
    )
    assert result["device_token"] not in json.dumps(row)
    client.portal.call(init_db)
    assert (
        client.portal.call(device_row, result["device_id"])["token_hash"]
        == row["token_hash"]
    )
    logs = json.loads(
        (settings.paths.user_info_file.parent / "audit_logs.json").read_text()
    )
    assert any(
        log["username"] == account["username"] and log["action"] == "DEVICE_REGISTER"
        for log in logs
    )
    assert result["device_token"] not in json.dumps(logs)


def test_register_bad_password(client: TestClient) -> None:
    """An unknown password cannot issue a device credential."""
    response = client.post(
        "/api/devices/register",
        json={"password": "incorrect", "device_name": "Phone", "platform": "android"},
    )
    assert response.status_code == 401


@pytest.mark.parametrize("platform", ["linux", "ANDROID", ""])
def test_register_invalid_platform(
    client: TestClient, account: dict[str, Any], platform: str
) -> None:
    """Platforms are restricted to the shared contract enum."""
    response = client.post(
        "/api/devices/register",
        json={
            "password": account["password"],
            "device_name": "Phone",
            "platform": platform,
        },
    )
    assert response.status_code == 422


@pytest.mark.parametrize(
    "path", ["bearer", "form", "query", "tus", "websocket", "helper"]
)
@pytest.mark.parametrize("revoked", [False, True])
def test_owner_paths(
    client: TestClient, account: dict[str, Any], path: str, revoked: bool
) -> None:
    """Device credentials authorize owner paths until explicitly revoked."""
    device = register(client, account)
    token = device["device_token"]
    username = account["username"]
    if revoked:
        assert (
            client.delete(
                f"/api/devices/{device['device_id']}", headers=bearer(token)
            ).status_code
            == 200
        )
    if path in {"bearer", "form"}:
        response = client.post(
            "/api/user/update-profile",
            data={
                "username": username,
                "show_in_list": "false",
                **({"token": token} if path == "form" else {}),
            },
            headers=bearer(token) if path == "bearer" else {},
        )
        assert response.status_code == (401 if revoked else 200)
    elif path == "query":
        response = client.get(f"/api/files/{username}", params={"token": token})
        assert response.status_code == (403 if revoked else 200)
    elif path == "tus":
        response = client.post(
            "/api/upload/tus",
            headers={
                "Upload-Length": "1",
                "Upload-Metadata": metadata(filename="photo.jpg", token=token),
            },
        )
        assert response.status_code == (401 if revoked else 201)
    elif path == "websocket":
        if revoked:
            with pytest.raises(WebSocketDisconnect) as denied:
                with client.websocket_connect(f"/api/ws/{username}?token={token}"):
                    pytest.fail("Revoked device connected")
            assert denied.value.code == 4003
        else:
            with client.websocket_connect(
                f"/api/ws/{username}?token={token}"
            ) as websocket:
                client.portal.call(event_service.notify_user_update, username)
                assert websocket.receive_text() == "REFRESH"
    elif revoked:
        with pytest.raises(HTTPException):
            client.portal.call(verify_ownership, token, username)
        with pytest.raises(HTTPException):
            client.portal.call(get_current_user_token, f"Bearer {token}")
    else:
        assert client.portal.call(verify_ownership, token, username)
        assert client.portal.call(get_current_user_token, f"Bearer {token}") == token


@pytest.mark.parametrize("credential", ["foreign", "share"])
def test_nonowners_rejected(
    client: TestClient, account: dict[str, Any], credential: str
) -> None:
    """Neither a foreign device nor a file capability grants owner rights."""
    other = client.portal.call(
        user_service.create_user,
        f"other-{uuid.uuid4().hex}",
        f"secret-{uuid.uuid4().hex}",
    )
    token = (
        register(client, account)["device_token"]
        if credential == "foreign"
        else token_service.create_token(other["username"], "photo.jpg")
    )
    client.portal.call(user_service.update_user, other["username"], {"is_locked": True})
    assert (
        client.post(
            "/api/user/update-profile",
            data={
                "username": other["username"],
                "show_in_list": "false",
                "token": token,
            },
        ).status_code
        == 401
    )
    assert (
        client.get(
            f"/api/files/{other['username']}", params={"token": token}
        ).status_code
        == 403
    )
    with pytest.raises(WebSocketDisconnect):
        with client.websocket_connect(f"/api/ws/{other['username']}?token={token}"):
            pytest.fail("Nonowner connected")
    if credential == "share":
        assert client.get("/api/devices", headers=bearer(token)).status_code == 401
        assert (
            client.post(
                "/api/upload/tus",
                headers={
                    "Upload-Length": "1",
                    "Upload-Metadata": metadata(filename="photo.jpg", token=token),
                },
            ).status_code
            == 401
        )


def test_device_management(client: TestClient, account: dict[str, Any]) -> None:
    """Lists are scoped and secret-free; only the device may patch itself."""
    first = register(client, account, push_token="old-push")
    second = register(client, account, device_name="Tablet")
    session = token_service.create_session_token(account["username"])
    listing = client.get("/api/devices", headers=bearer(session))
    assert listing.status_code == 200
    assert {device["id"] for device in listing.json()} == {
        first["device_id"],
        second["device_id"],
    }
    assert "token_hash" not in listing.text and "push_token" not in listing.text
    assert first["device_token"] not in listing.text
    assert (
        client.patch(
            f"/api/devices/{second['device_id']}",
            headers=bearer(first["device_token"]),
            json={"device_name": "Intruder"},
        ).status_code
        == 403
    )
    assert (
        client.delete(
            f"/api/devices/{second['device_id']}", headers=bearer(first["device_token"])
        ).status_code
        == 403
    )
    assert (
        client.patch(
            f"/api/devices/{first['device_id']}",
            headers=bearer(session),
            json={"device_name": "Session"},
        ).status_code
        == 403
    )
    assert client.patch(
        f"/api/devices/{first['device_id']}",
        headers=bearer(first["device_token"]),
        json={"device_name": "Renamed", "push_token": None},
    ).json() == {"ok": True}
    row = client.portal.call(device_row, first["device_id"])
    assert row["device_name"] == "Renamed" and row["push_token"] is None
    assert client.delete(
        f"/api/devices/{second['device_id']}", headers=bearer(session)
    ).json() == {"ok": True}
    assert client.portal.call(device_row, second["device_id"])["revoked_at"] is not None


def test_last_seen_throttled(client: TestClient, account: dict[str, Any]) -> None:
    """Owner resolution updates last-seen no more than once a minute."""
    device = register(client, account)
    token = device["device_token"]

    async def age() -> None:
        """Age last-seen metadata to exercise the throttled database write."""
        database = await get_users_db()
        await database.execute(
            "UPDATE devices SET last_seen_at = '2000-01-01T00:00:00+00:00' WHERE id = ?",
            (device["device_id"],),
        )
        await database.commit()

    client.portal.call(age)
    assert client.get("/api/devices", headers=bearer(token)).status_code == 200
    timestamp = client.portal.call(device_row, device["device_id"])["last_seen_at"]
    assert timestamp != "2000-01-01T00:00:00+00:00"
    assert client.get("/api/devices", headers=bearer(token)).status_code == 200
    assert (
        client.portal.call(device_row, device["device_id"])["last_seen_at"] == timestamp
    )


def test_backup_folder_idempotent(client: TestClient, account: dict[str, Any]) -> None:
    """Backup calls reuse a sanitized file-folder tree and reject sessions."""
    device = register(client, account)
    fields = {"device_name": " ../Pixel\\Camera/ "}
    first = client.post(
        "/api/backup/folder", headers=bearer(device["device_token"]), json=fields
    )
    assert first.status_code == 200, first.text
    second = client.post(
        "/api/backup/folder", headers=bearer(device["device_token"]), json=fields
    )
    assert second.json() == first.json()
    names = client.portal.call(
        user_service.get_folder_path_names,
        account["username"],
        first.json()["folder_id"],
    )
    assert names == ["相簿備份", "__Pixel_Camera_"]
    assert (
        len(
            client.portal.call(
                user_service.get_folders_by_username, account["username"]
            )
        )
        == 2
    )
    assert (
        client.post(
            "/api/backup/folder",
            headers=bearer(token_service.create_session_token(account["username"])),
            json=fields,
        ).status_code
        == 403
    )


@pytest.mark.parametrize("relative", [False, True])
def test_tus_folder_placement(
    client: TestClient, account: dict[str, Any], relative: bool
) -> None:
    """TUS imports into the owned physical folder and records its device."""
    device = register(client, account)
    folder_id = client.portal.call(
        user_service.add_folder, account["username"], "Photos", "file"
    )
    fields = {
        "filename": "photo.jpg",
        "token": device["device_token"],
        "folder_id": folder_id,
    }
    if relative:
        fields["relativePath"] = "Camera/2026/photo.jpg"
    created = client.post(
        "/api/upload/tus",
        headers={"Upload-Length": "5", "Upload-Metadata": metadata(**fields)},
    )
    assert created.status_code == 201, created.text
    location = created.headers["Location"]
    from backend.routes.tus import metadata_store

    upload = metadata_store.get_upload(location.rsplit("/", 1)[-1])
    assert upload["metadata"]["device_id"] == device["device_id"]
    assert device["device_token"] not in json.dumps(upload)
    assert (
        client.patch(
            location,
            content=b"photo",
            headers={"Upload-Offset": "0", **bearer(device["device_token"])},
        ).status_code
        == 204
    )
    expected_path = ["Photos", "Camera", "2026"] if relative else ["Photos"]
    path = settings.paths.upload_folder / account["folder"]
    assert path.joinpath(*expected_path, "photo.jpg").read_bytes() == b"photo"

    async def placement() -> str:
        """Read the finished file destination from the real index."""
        database = await get_files_db()
        cursor = await database.execute(
            "SELECT folder_id FROM files WHERE username = ? AND filename = 'photo.jpg'",
            (account["folder"],),
        )
        return (await cursor.fetchone())["folder_id"]

    actual_folder = client.portal.call(placement)
    assert (
        client.portal.call(
            user_service.get_folder_path_names, account["username"], actual_folder
        )
        == expected_path
    )


def test_tus_foreign_folder_and_continuation(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Foreign destinations and credentials cannot mutate another upload."""
    device = register(client, account)
    other_name = f"foreign-{uuid.uuid4().hex}"
    other_password = f"pw-{other_name}"
    client.portal.call(user_service.create_user, other_name, other_password)
    foreign_folder = client.portal.call(
        user_service.add_folder, other_name, "Foreign", "file"
    )
    response = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "1",
            "Upload-Metadata": metadata(
                filename="foreign.jpg",
                token=device["device_token"],
                folder_id=foreign_folder,
            ),
        },
    )
    assert response.status_code == 403
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "1",
            "Upload-Metadata": metadata(
                filename="owned.jpg", token=device["device_token"]
            ),
        },
    )
    assert created.status_code == 201
    location = created.headers["Location"]
    foreign_token = token_service.create_session_token(other_name)
    for method in ("head", "patch", "delete"):
        response = client.request(
            method,
            location,
            content=b"x" if method == "patch" else None,
            headers={"Upload-Offset": "0", **bearer(foreign_token)},
        )
        assert response.status_code == 403
    assert (
        client.delete(
            f"/api/devices/{device['device_id']}",
            headers=bearer(device["device_token"]),
        ).status_code
        == 200
    )
    for method in ("head", "patch", "delete"):
        response = client.request(
            method,
            location,
            content=b"x" if method == "patch" else None,
            headers={"Upload-Offset": "0", **bearer(device["device_token"])},
        )
        assert response.status_code == 403


def test_legacy_upload_device(client: TestClient, account: dict[str, Any]) -> None:
    """Legacy upload accepts the persistent form credential."""
    device = register(client, account)
    response = client.post(
        "/api/upload",
        data={"token": device["device_token"]},
        files={"files": ("legacy.jpg", b"photo")},
    )
    assert response.status_code == 200
    assert (
        settings.paths.upload_folder / account["folder"] / "legacy.jpg"
    ).read_bytes() == b"photo"


def test_tus_replaces_revoked_origin_resume(
    client: TestClient,
    account: dict[str, Any],
) -> None:
    """A newly registered device can restart a revoked device's fingerprint."""
    first = register(client, account)
    fields = {
        "Upload-Length": "5",
        "Upload-Metadata": metadata(filename="resume.jpg", token=first["device_token"]),
    }
    original = client.post("/api/upload/tus", headers=fields)
    assert original.status_code == 201
    assert (
        client.delete(
            f"/api/devices/{first['device_id']}", headers=bearer(first["device_token"])
        ).status_code
        == 200
    )
    second = register(client, account)
    fields["Upload-Metadata"] = metadata(
        filename="resume.jpg", token=second["device_token"]
    )
    restarted = client.post("/api/upload/tus", headers=fields)
    assert restarted.status_code == 201, restarted.text
    assert restarted.headers["Location"] != original.headers["Location"]
    response = client.patch(
        restarted.headers["Location"],
        content=b"photo",
        headers={"Upload-Offset": "0", **bearer(second["device_token"])},
    )
    assert response.status_code == 204
    assert (
        settings.paths.upload_folder / account["folder"] / "resume.jpg"
    ).read_bytes() == b"photo"


def test_tus_password_fallback_continues_without_headers(
    client: TestClient,
    account: dict[str, Any],
) -> None:
    """A valid password remains the continuation credential after token failure."""
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "5",
            "Upload-Metadata": metadata(
                filename="password-fallback.jpg",
                token="invalid-session",
                password=account["password"],
            ),
        },
    )
    assert created.status_code == 201
    location = created.headers["Location"]
    assert client.head(location).status_code == 200
    assert (
        client.patch(
            location, content=b"photo", headers={"Upload-Offset": "0"}
        ).status_code
        == 204
    )
    assert (
        settings.paths.upload_folder / account["folder"] / "password-fallback.jpg"
    ).read_bytes() == b"photo"


@pytest.mark.parametrize("origin", ["session", "password"])
def test_tus_replaces_expired_origin_resume(
    client: TestClient,
    account: dict[str, Any],
    origin: str,
) -> None:
    """Expired sessions and changed passwords cannot poison resume lookups."""
    from datetime import datetime

    first_session = token_service.create_session_token(account["username"])
    credentials = (
        {"token": first_session}
        if origin == "session"
        else {"password": account["password"]}
    )
    fields = {
        "Upload-Length": "5",
        "Upload-Metadata": metadata(filename="expired-resume.jpg", **credentials),
    }
    original = client.post("/api/upload/tus", headers=fields)
    assert original.status_code == 201
    if origin == "session":
        token_service.tokens[first_session].expiry = datetime(2000, 1, 1)
    else:
        assert client.portal.call(
            user_service.reset_password,
            account["username"],
            "replacement-" + account["password"],
        )
    fields["Upload-Metadata"] = metadata(
        filename="expired-resume.jpg",
        token=token_service.create_session_token(account["username"]),
    )
    restarted = client.post("/api/upload/tus", headers=fields)
    assert restarted.status_code == 201, restarted.text
    assert restarted.headers["Location"] != original.headers["Location"]
    assert client.head(restarted.headers["Location"]).status_code == 200
    assert (
        client.patch(
            restarted.headers["Location"],
            content=b"photo",
            headers={"Upload-Offset": "0"},
        ).status_code
        == 204
    )
    assert (
        settings.paths.upload_folder / account["folder"] / "expired-resume.jpg"
    ).read_bytes() == b"photo"
