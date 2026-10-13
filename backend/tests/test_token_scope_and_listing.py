"""Share-token scope, anonymous file listing, and folder-zip storage path.

Fixture layout for ``USERNAME`` (all files are small PNG images):

    shared.png        own lock set   (the file share tokens are issued for)
    other.png         own lock set   (a different locked file of the same owner)
    public.png        unlocked, at the root
    vault/hidden.png  unlocked itself, but ``vault`` is locked

``ZIP_USERNAME`` stores its files under a physical folder whose name differs
from the username, to exercise the folder-zip download path resolution.
"""

import base64
import io
import zipfile
from datetime import datetime
from typing import Optional

import pytest
from fastapi import HTTPException, WebSocketDisconnect
from fastapi.testclient import TestClient
from PIL import Image

from backend.core.auth import verify_ownership
from backend.services.event_service import event_service
from backend.services.file_service import file_service
from backend.services.token_service import token_service
from backend.services.user_service import user_service

USERNAME = "tokenscopeuser"
PASSWORD = "token-scope-pass-123"
SHARED_FILE = "shared.png"
OTHER_LOCKED_FILE = "other.png"
PUBLIC_FILE = "public.png"
FOLDER_LOCKED_FILE = "hidden.png"
ALL_FILES = {SHARED_FILE, OTHER_LOCKED_FILE, PUBLIC_FILE, FOLDER_LOCKED_FILE}

ZIP_USERNAME = "zipowner"
ZIP_PASSWORD = "zip-owner-pass-123"
ZIP_STORAGE_FOLDER = "zip_physical_storage"
ZIP_FILE = "report.txt"
ZIP_FILE_CONTENT = b"quarterly report"

_folder_ids: dict = {}


def _png_bytes() -> bytes:
    """Encode a tiny solid-colour PNG so the thumbnail endpoint can render it.

    Returns:
        PNG-encoded image bytes.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color=(30, 200, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _place_file(
    username: str, folder_id: Optional[str], filename: str, content: bytes
) -> None:
    """Write a file into a user's folder and register it in files.db.

    Args:
        username: Owner of the file.
        folder_id: Target folder ID, or None for the user's root.
        filename: Name of the file to create.
        content: File bytes.
    """
    user = await user_service.get_user_by_name(username)
    path_names = await user_service.get_folder_path_names(username, folder_id)
    folder_path = file_service._get_folder_path(user["folder"], path_names)
    (folder_path / filename).write_bytes(content)
    await file_service._register_file(
        user["folder"], filename, len(content), datetime.now(), folder_id
    )


async def _seed() -> None:
    """Create both fixture users with their files, folders, and locks."""
    await user_service.create_user(USERNAME, PASSWORD)
    vault_id = await user_service.add_folder(USERNAME, "vault", "file")
    for filename in (SHARED_FILE, OTHER_LOCKED_FILE, PUBLIC_FILE):
        await _place_file(USERNAME, None, filename, _png_bytes())
    await _place_file(USERNAME, vault_id, FOLDER_LOCKED_FILE, _png_bytes())
    user = await user_service.get_user_by_name(USERNAME)
    for filename in (SHARED_FILE, OTHER_LOCKED_FILE):
        assert await file_service.toggle_file_lock(user["folder"], filename, True)
    assert await user_service.toggle_folder_lock(USERNAME, vault_id, True)

    await user_service.create_user(ZIP_USERNAME, ZIP_PASSWORD, folder=ZIP_STORAGE_FOLDER)
    docs_id = await user_service.add_folder(ZIP_USERNAME, "docs", "file")
    await _place_file(ZIP_USERNAME, docs_id, ZIP_FILE, ZIP_FILE_CONTENT)
    _folder_ids["docs"] = docs_id


@pytest.fixture(scope="module")
def seeded_client(client: TestClient) -> TestClient:
    """Return the shared client after seeding this module's fixture users.

    Args:
        client: Session-wide TestClient.

    Returns:
        The same client, with test data in place.
    """
    client.portal.call(_seed)
    return client


@pytest.fixture()
def share_token() -> str:
    """Mint a share token scoped to ``SHARED_FILE``.

    Returns:
        The share token string.
    """
    return token_service.create_token(USERNAME, SHARED_FILE)


@pytest.fixture()
def session_token() -> str:
    """Mint an owner session token for ``USERNAME``.

    Returns:
        The session token string.
    """
    return token_service.create_session_token(USERNAME)


# ---------------------------------------------------------------------------
# 1. Share tokens are scoped to the exact file they were issued for
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("inline", [False, True])
@pytest.mark.parametrize("filename", [OTHER_LOCKED_FILE, FOLDER_LOCKED_FILE])
def test_share_token_cannot_download_other_locked_file(
    seeded_client: TestClient, share_token: str, filename: str, inline: bool
) -> None:
    """A share token for one file does not unlock other locked files."""
    params = {"token": share_token}
    if inline:
        params["inline"] = "true"
    response = seeded_client.get(f"/api/download/{USERNAME}/{filename}", params=params)
    assert response.status_code == 403


@pytest.mark.parametrize("filename", [OTHER_LOCKED_FILE, FOLDER_LOCKED_FILE])
def test_share_token_cannot_thumbnail_other_locked_file(
    seeded_client: TestClient, share_token: str, filename: str
) -> None:
    """A share token for one file does not unlock other files' thumbnails."""
    response = seeded_client.get(
        f"/api/thumbnail/{USERNAME}/{filename}", params={"token": share_token}
    )
    assert response.status_code == 403


def test_share_token_still_works_for_its_own_file(
    seeded_client: TestClient, share_token: str
) -> None:
    """Every URL the share page builds keeps working for the shared file."""
    info = seeded_client.get(f"/api/share-info/{share_token}")
    assert info.status_code == 200
    body = info.json()
    assert body["filename"] == SHARED_FILE

    for url in (body["preview_url"], body["download_url"], body["thumbnail_url"]):
        response = seeded_client.get(url)
        assert response.status_code == 200, url

    download = seeded_client.get(
        f"/api/download/{USERNAME}/{SHARED_FILE}", params={"token": share_token}
    )
    assert download.status_code == 200
    assert download.content == _png_bytes()


@pytest.mark.parametrize("filename", [SHARED_FILE, OTHER_LOCKED_FILE, FOLDER_LOCKED_FILE])
def test_session_token_keeps_owner_wide_access(
    seeded_client: TestClient, session_token: str, filename: str
) -> None:
    """The owner's session token unlocks every locked file and thumbnail."""
    params = {"token": session_token}
    download = seeded_client.get(f"/api/download/{USERNAME}/{filename}", params=params)
    assert download.status_code == 200
    thumbnail = seeded_client.get(f"/api/thumbnail/{USERNAME}/{filename}", params=params)
    assert thumbnail.status_code == 200


def test_share_token_cannot_mint_share_for_other_locked_file(
    seeded_client: TestClient, share_token: str
) -> None:
    """Share-link creation for a locked file needs an owner token."""
    response = seeded_client.post(
        f"/api/share/{USERNAME}/{OTHER_LOCKED_FILE}", data={"token": share_token}
    )
    assert response.status_code == 403


def test_share_token_cannot_delete_files(
    seeded_client: TestClient, share_token: str
) -> None:
    """A share token is not an owner credential for mutations."""
    response = seeded_client.post(
        f"/api/user/{USERNAME}/delete",
        data={"filename": PUBLIC_FILE, "token": share_token},
    )
    assert response.status_code == 401
    still_there = seeded_client.get(f"/api/download/{USERNAME}/{PUBLIC_FILE}")
    assert still_there.status_code == 200


def test_share_token_cannot_upload(seeded_client: TestClient, share_token: str) -> None:
    """A share token cannot be used to upload into the owner's storage."""
    response = seeded_client.post(
        "/api/upload",
        data={"token": share_token},
        files={"files": ("intruder.txt", b"intruder", "text/plain")},
    )
    assert response.status_code == 401


def test_share_token_does_not_authenticate_dashboard(
    seeded_client: TestClient, share_token: str
) -> None:
    """The dashboard treats a share token like no token at all."""
    response = seeded_client.get(f"/api/user/{USERNAME}", params={"token": share_token})
    assert response.status_code == 200
    names = {entry["name"] for entry in response.json()["files"]}
    assert names == {PUBLIC_FILE}


def test_share_endpoints_reject_session_tokens(
    seeded_client: TestClient, session_token: str
) -> None:
    """Share-info and share download only accept share tokens."""
    assert seeded_client.get(f"/api/share-info/{session_token}").status_code == 404
    assert seeded_client.get(f"/api/download-shared/{session_token}").status_code == 404


# ---------------------------------------------------------------------------
# 2. Anonymous file listing hides effectively locked files
# ---------------------------------------------------------------------------


def test_anonymous_listing_hides_locked_files(seeded_client: TestClient) -> None:
    """Without an owner token only unlocked files outside locked folders are listed."""
    response = seeded_client.get(f"/api/files/{USERNAME}")
    assert response.status_code == 200
    assert {entry["name"] for entry in response.json()} == {PUBLIC_FILE}


def test_share_token_listing_hides_locked_files(
    seeded_client: TestClient, share_token: str
) -> None:
    """A share token does not reveal the owner's locked files in the listing."""
    response = seeded_client.get(f"/api/files/{USERNAME}", params={"token": share_token})
    assert response.status_code == 200
    assert {entry["name"] for entry in response.json()} == {PUBLIC_FILE}


def test_owner_listing_shows_all_files(
    seeded_client: TestClient, session_token: str
) -> None:
    """The owner's session token lists every file with the unchanged shape."""
    response = seeded_client.get(f"/api/files/{USERNAME}", params={"token": session_token})
    assert response.status_code == 200
    entries = response.json()
    assert {entry["name"] for entry in entries} == ALL_FILES
    by_name = {entry["name"]: entry for entry in entries}
    assert by_name[SHARED_FILE]["is_locked"] is True
    assert set(by_name[PUBLIC_FILE]) >= {"name", "size", "created", "is_locked", "folder_id"}


# ---------------------------------------------------------------------------
# 3. Folder-zip download resolves the user's physical storage folder
# ---------------------------------------------------------------------------


def test_folder_zip_uses_physical_storage_folder(seeded_client: TestClient) -> None:
    """Folder zips work for users whose storage folder differs from the username."""
    response = seeded_client.get(
        f"/api/user/{ZIP_USERNAME}/folders/{_folder_ids['docs']}/download"
    )
    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert archive.namelist() == [f"docs/{ZIP_FILE}"]
    assert archive.read(f"docs/{ZIP_FILE}") == ZIP_FILE_CONTENT


# ---------------------------------------------------------------------------
# Share tokens are not owner credentials anywhere else either
# ---------------------------------------------------------------------------

WS_LOCKED_USERNAME = "wslockeduser"
WS_LOCKED_PASSWORD = "ws-locked-pass-123"


async def _seed_locked_ws_user() -> None:
    """Create a user-level locked account for the WebSocket tests."""
    await user_service.create_user(WS_LOCKED_USERNAME, WS_LOCKED_PASSWORD)
    assert await user_service.update_user(WS_LOCKED_USERNAME, {"is_locked": True})


@pytest.fixture(scope="module")
def ws_locked_client(seeded_client: TestClient) -> TestClient:
    """Return the shared client after seeding the locked WebSocket user.

    Args:
        seeded_client: Client with this module's main fixtures seeded.

    Returns:
        The same client, with the locked user in place.
    """
    seeded_client.portal.call(_seed_locked_ws_user)
    return seeded_client


def _tus_metadata(**fields: str) -> str:
    """Encode TUS ``Upload-Metadata`` header pairs.

    Args:
        **fields: Metadata keys and plain-text values.

    Returns:
        The header value with base64-encoded values.
    """
    return ",".join(
        f"{key} {base64.b64encode(value.encode()).decode()}" for key, value in fields.items()
    )


def test_share_token_cannot_start_tus_upload(
    seeded_client: TestClient, share_token: str
) -> None:
    """A share token cannot open a resumable upload in the owner's storage."""
    response = seeded_client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "4",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": _tus_metadata(filename="intruder.bin", token=share_token),
        },
    )
    assert response.status_code == 401


def test_session_token_can_start_tus_upload(
    seeded_client: TestClient, session_token: str
) -> None:
    """The owner's session token still opens resumable uploads."""
    response = seeded_client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "4",
            "Tus-Resumable": "1.0.0",
            "Upload-Metadata": _tus_metadata(filename="owner.bin", token=session_token),
        },
    )
    assert response.status_code == 201


def test_share_token_cannot_subscribe_to_locked_user_events(
    ws_locked_client: TestClient,
) -> None:
    """A share token does not authenticate the WebSocket of a locked user.

    If the handshake were wrongly accepted, the pushed update lets
    ``receive_text`` return instead of blocking, so the test fails with
    "DID NOT RAISE" rather than hanging.
    """
    share_for_locked = token_service.create_token(WS_LOCKED_USERNAME, "anything.txt")
    with pytest.raises(WebSocketDisconnect) as disconnect:
        with ws_locked_client.websocket_connect(
            f"/api/ws/{WS_LOCKED_USERNAME}?token={share_for_locked}"
        ) as websocket:
            ws_locked_client.portal.call(event_service.notify_user_update, WS_LOCKED_USERNAME)
            websocket.receive_text()
    assert disconnect.value.code == 4003


def test_session_token_can_subscribe_to_locked_user_events(
    ws_locked_client: TestClient,
) -> None:
    """The owner's session token still receives the locked user's update events."""
    owner_token = token_service.create_session_token(WS_LOCKED_USERNAME)
    with ws_locked_client.websocket_connect(
        f"/api/ws/{WS_LOCKED_USERNAME}?token={owner_token}"
    ) as websocket:
        ws_locked_client.portal.call(event_service.notify_user_update, WS_LOCKED_USERNAME)
        assert websocket.receive_text() == "REFRESH"


def test_verify_ownership_rejects_share_tokens(seeded_client: TestClient) -> None:
    """The ownership helper treats share tokens as non-owners."""
    share_for_user = token_service.create_token(USERNAME, SHARED_FILE)
    with pytest.raises(HTTPException) as denied:
        seeded_client.portal.call(verify_ownership, share_for_user, USERNAME)
    assert denied.value.status_code == 403
    assert seeded_client.portal.call(verify_ownership, token_service.create_session_token(USERNAME), USERNAME)
