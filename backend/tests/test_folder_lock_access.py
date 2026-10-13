"""Folder locks must protect the files inside them on every file endpoint.

Fixture layout for ``USERNAME`` (each folder holds one image file):

    vault/            (locked)   -> vault.png
    vault/inner/      (unlocked) -> inner.png   (locked via its ancestor)
    public/           (unlocked) -> public.png

Each file's own ``files.is_locked`` flag stays 0, so any denial below comes
from the folder chain alone.
"""

import io
import zipfile
from datetime import datetime
from typing import Any, Dict, Optional

import pytest
from fastapi.testclient import TestClient
from PIL import Image

from backend.services.file_service import file_service
from backend.services.token_service import token_service
from backend.services.user_service import user_service

USERNAME = "folderlockuser"
PASSWORD = "folder-lock-pass-123"
VAULT_FILE = "vault.png"
INNER_FILE = "inner.png"
PUBLIC_FILE = "public.png"
LOCKED_FILES = [VAULT_FILE, INNER_FILE]


def _png_bytes() -> bytes:
    """Encode a tiny solid-colour PNG so the thumbnail endpoint can render it.

    Returns:
        PNG-encoded image bytes.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (8, 8), color=(200, 30, 30)).save(buffer, format="PNG")
    return buffer.getvalue()


async def _place_file(folder_id: str, filename: str) -> None:
    """Write ``filename`` into the folder and register it in files.db.

    Args:
        folder_id: Target folder ID.
        filename: Name of the file to create.
    """
    user = await user_service.get_user_by_name(USERNAME)
    path_names = await user_service.get_folder_path_names(USERNAME, folder_id)
    folder_path = file_service._get_folder_path(user["folder"], path_names)
    content = _png_bytes()
    (folder_path / filename).write_bytes(content)
    await file_service._register_file(
        user["folder"], filename, len(content), datetime.now(), folder_id
    )


async def _seed_locked_tree() -> None:
    """Create the user, folder tree, files, and lock the ``vault`` folder."""
    await user_service.create_user(USERNAME, PASSWORD)
    vault_id = await user_service.add_folder(USERNAME, "vault", "file")
    inner_id = await user_service.add_folder(USERNAME, "inner", "file", vault_id)
    public_id = await user_service.add_folder(USERNAME, "public", "file")
    await _place_file(vault_id, VAULT_FILE)
    await _place_file(inner_id, INNER_FILE)
    await _place_file(public_id, PUBLIC_FILE)
    assert await user_service.toggle_folder_lock(USERNAME, vault_id, True)


@pytest.fixture(scope="module")
def seeded_client(client: TestClient) -> TestClient:
    """Return the shared client after seeding the locked-folder fixture user.

    Args:
        client: Session-wide TestClient.

    Returns:
        The same client, with test data in place.
    """
    client.portal.call(_seed_locked_tree)
    return client


def _download(
    client: TestClient, filename: str, token: Optional[str] = None, inline: bool = False
) -> Any:
    """GET the direct download (or inline preview) endpoint.

    Args:
        client: TestClient to use.
        filename: File to fetch.
        token: Optional session/share token.
        inline: Whether to request inline (preview) disposition.

    Returns:
        The HTTP response.
    """
    params: Dict[str, Any] = {}
    if token is not None:
        params["token"] = token
    if inline:
        params["inline"] = "true"
    return client.get(f"/api/download/{USERNAME}/{filename}", params=params)


@pytest.mark.parametrize("filename", LOCKED_FILES)
@pytest.mark.parametrize("inline", [False, True])
def test_download_of_file_in_locked_folder_requires_auth(
    seeded_client: TestClient, filename: str, inline: bool
) -> None:
    """Anonymous download/preview of a file under a locked folder is denied."""
    assert _download(seeded_client, filename, inline=inline).status_code == 403


def test_download_of_file_in_unlocked_folder_is_public(seeded_client: TestClient) -> None:
    """Files outside any locked folder remain publicly downloadable."""
    response = _download(seeded_client, PUBLIC_FILE)
    assert response.status_code == 200
    assert response.content == _png_bytes()


@pytest.mark.parametrize("filename", LOCKED_FILES)
def test_download_with_session_token_still_works(
    seeded_client: TestClient, filename: str
) -> None:
    """The owner's session token unlocks files in locked folders."""
    session_token = token_service.create_session_token(USERNAME)
    response = _download(seeded_client, filename, token=session_token, inline=True)
    assert response.status_code == 200
    assert response.content == _png_bytes()


@pytest.mark.parametrize("filename", LOCKED_FILES)
def test_share_token_for_file_still_works(seeded_client: TestClient, filename: str) -> None:
    """A share token issued for a file keeps working for preview, info and download."""
    share_token = token_service.create_token(USERNAME, filename)

    preview = _download(seeded_client, filename, token=share_token, inline=True)
    assert preview.status_code == 200

    info = seeded_client.get(f"/api/share-info/{share_token}")
    assert info.status_code == 200
    assert info.json()["is_locked"] is True

    shared = seeded_client.get(f"/api/download-shared/{share_token}")
    assert shared.status_code == 200
    assert shared.content == _png_bytes()

    thumbnail = seeded_client.get(
        f"/api/thumbnail/{USERNAME}/{filename}", params={"token": share_token}
    )
    assert thumbnail.status_code == 200


def test_share_info_reports_unlocked_public_file(seeded_client: TestClient) -> None:
    """Share info for a file outside locked folders reports ``is_locked`` False."""
    share_token = token_service.create_token(USERNAME, PUBLIC_FILE)
    info = seeded_client.get(f"/api/share-info/{share_token}")
    assert info.status_code == 200
    assert info.json()["is_locked"] is False


@pytest.mark.parametrize("filename", LOCKED_FILES)
def test_thumbnail_of_file_in_locked_folder_requires_auth(
    seeded_client: TestClient, filename: str
) -> None:
    """Thumbnails of files under a locked folder need a token."""
    url = f"/api/thumbnail/{USERNAME}/{filename}"
    assert seeded_client.get(url).status_code == 403

    session_token = token_service.create_session_token(USERNAME)
    assert seeded_client.get(url, params={"token": session_token}).status_code == 200


def test_thumbnail_of_file_in_unlocked_folder_is_public(seeded_client: TestClient) -> None:
    """Thumbnails outside locked folders stay public."""
    response = seeded_client.get(f"/api/thumbnail/{USERNAME}/{PUBLIC_FILE}")
    assert response.status_code == 200


@pytest.mark.parametrize("filename", LOCKED_FILES)
def test_create_share_for_file_in_locked_folder_requires_auth(
    seeded_client: TestClient, filename: str
) -> None:
    """Anonymous callers cannot mint share tokens for files in locked folders."""
    url = f"/api/share/{USERNAME}/{filename}"
    assert seeded_client.post(url).status_code == 403

    session_token = token_service.create_session_token(USERNAME)
    allowed = seeded_client.post(url, data={"token": session_token})
    assert allowed.status_code == 200
    assert allowed.json()["success"] is True


def test_create_share_for_file_in_unlocked_folder_is_public(
    seeded_client: TestClient,
) -> None:
    """Share creation for files outside locked folders needs no token."""
    response = seeded_client.post(f"/api/share/{USERNAME}/{PUBLIC_FILE}")
    assert response.status_code == 200


@pytest.mark.parametrize("filename", LOCKED_FILES)
def test_batch_download_with_file_in_locked_folder_requires_auth(
    seeded_client: TestClient, filename: str
) -> None:
    """A batch containing a file under a locked folder requires credentials."""
    url = f"/api/user/{USERNAME}/batch-download"
    denied = seeded_client.post(url, data={"filenames": [PUBLIC_FILE, filename]})
    assert denied.status_code == 403

    allowed = seeded_client.post(
        url, data={"filenames": [PUBLIC_FILE, filename], "password": PASSWORD}
    )
    assert allowed.status_code == 200
    names = zipfile.ZipFile(io.BytesIO(allowed.content)).namelist()
    assert any(name.endswith(filename) for name in names)


def test_batch_download_of_unlocked_folder_files_is_public(
    seeded_client: TestClient,
) -> None:
    """A batch with only files outside locked folders needs no credentials."""
    response = seeded_client.post(
        f"/api/user/{USERNAME}/batch-download", data={"filenames": [PUBLIC_FILE]}
    )
    assert response.status_code == 200
    assert zipfile.ZipFile(io.BytesIO(response.content)).namelist() == [
        f"public/{PUBLIC_FILE}"
    ]
