"""Uploads sent like the Android queue worker must show up on the dashboard.

The helpers replay the exact request sequence of the native ``TusClient`` /
``UploadQueueWorker`` (POST with the device token in ``Upload-Metadata``, an
immediate ``HEAD``, then ``PATCH`` chunks without an Authorization header) and
then read ``GET /api/user/{username}``, the listing the dashboard renders.
"""

import base64
import hashlib
import os
import tempfile
from pathlib import Path
from typing import Any, Iterator, Optional

import pytest
from fastapi.testclient import TestClient
from httpx import Response

from backend.config import settings
from backend.services.dedup_service import dedup_service
from backend.services.user_service import user_service

TUS_HEADERS: dict[str, str] = {"Tus-Resumable": "1.0.0"}


def encode_metadata(fields: dict[str, str]) -> str:
    """Encode ``Upload-Metadata`` the way ``TusClient.encodeMetadata`` does.

    Args:
        fields: Metadata key/values.

    Returns:
        Header value with base64-encoded values.
    """
    return ",".join(
        f"{key} {base64.b64encode(value.encode()).decode()}"
        for key, value in fields.items()
    )


def register_device(client: TestClient, account: dict[str, Any]) -> str:
    """Register an Android device and return its token.

    Args:
        client: Application client.
        account: Seeded account with its password.

    Returns:
        Raw device token.
    """
    response = client.post(
        "/api/devices/register",
        json={
            "password": account["password"],
            "device_name": "Pixel",
            "platform": "android",
        },
    )
    assert response.status_code == 200, response.text
    return response.json()["device_token"]


def native_create(
    client: TestClient,
    device_token: str,
    filename: str,
    size: int,
    folder_id: Optional[str] = None,
) -> str:
    """Create the upload like ``TusClient.create`` and return its URL.

    Args:
        client: Application client.
        device_token: Device credential stored by the app.
        filename: Picked file name.
        size: Total size in bytes.
        folder_id: Optional destination folder.

    Returns:
        Upload URL from the ``Location`` header.
    """
    fields = {
        "filename": filename,
        "filetype": "image/jpeg",
        "token": device_token,
        "lastModified": "1760000000000",
    }
    if folder_id is not None:
        fields["folder_id"] = folder_id
    created = client.post(
        "/api/upload/tus",
        content=b"",
        headers={
            **TUS_HEADERS,
            "Upload-Length": str(size),
            "Upload-Metadata": encode_metadata(fields),
        },
    )
    assert created.status_code in (200, 201), created.text
    location = created.headers["Location"]
    head = client.head(location, headers=TUS_HEADERS)
    assert head.status_code == 200
    assert head.headers["Upload-Offset"] == "0"
    return location


def native_patch(client: TestClient, location: str, body: bytes) -> Response:
    """Send one chunk like ``TusClient.upload`` (no Authorization header).

    Args:
        client: Application client.
        location: Upload URL.
        body: Whole file content (one chunk).

    Returns:
        The PATCH response.
    """
    return client.patch(
        location,
        content=body,
        headers={
            **TUS_HEADERS,
            "Upload-Offset": "0",
            "Content-Type": "application/offset+octet-stream",
        },
    )


def native_upload(
    client: TestClient,
    device_token: str,
    filename: str,
    body: bytes,
    folder_id: Optional[str] = None,
) -> None:
    """Upload one file end to end and require the worker's success condition.

    Args:
        client: Application client.
        device_token: Device credential.
        filename: Picked file name.
        body: File content.
        folder_id: Optional destination folder.
    """
    location = native_create(client, device_token, filename, len(body), folder_id)
    patched = native_patch(client, location, body)
    assert patched.status_code == 204, patched.text
    assert patched.headers["Upload-Offset"] == str(len(body))


def dashboard_files(client: TestClient, account: dict[str, Any]) -> list[dict[str, Any]]:
    """Read the files the owner's dashboard lists.

    Args:
        client: Application client.
        account: Seeded account.

    Returns:
        File entries of ``GET /api/user/{username}``.
    """
    login = client.post("/api/login", data={"password": account["password"]})
    assert login.status_code == 200, login.text
    response = client.get(
        f"/api/user/{account['username']}",
        headers={"Authorization": f"Bearer {login.json()['token']}"},
    )
    assert response.status_code == 200, response.text
    return response.json()["files"]


@pytest.fixture()
def tus_temp_on_other_filesystem(monkeypatch: pytest.MonkeyPatch) -> Iterator[Path]:
    """Put the TUS temp folder on a different filesystem than the uploads.

    The Windows deployment (``deploy/windows/docker-compose.override.yml``)
    bind-mounts ``uploads`` and ``tus_temp`` separately, so inside the
    container they are two mount points and ``rename(2)`` between them fails
    with ``EXDEV``. ``/dev/shm`` (tmpfs) reproduces that on Linux.

    Yields:
        The temporary TUS folder.
    """
    temp_root = Path(tempfile.mkdtemp(prefix="tus-other-fs-", dir="/dev/shm"))
    upload_device = os.stat(settings.paths.upload_folder).st_dev
    assert os.stat(temp_root).st_dev != upload_device, "need two filesystems"
    monkeypatch.setattr(settings.paths, "tus_temp_folder", temp_root)
    yield temp_root


def test_upload_visible_when_tus_temp_is_a_separate_mount(
    client: TestClient,
    account: dict[str, Any],
    tus_temp_on_other_filesystem: Path,
) -> None:
    """A finished native upload is listed even across mount points."""
    device_token = register_device(client, account)
    body = b"photo-bytes-" + os.urandom(16)

    native_upload(client, device_token, "IMG_0001.jpg", body)

    names = [entry["name"] for entry in dashboard_files(client, account)]
    assert names == ["IMG_0001.jpg"]
    stored = settings.paths.upload_folder / account["folder"] / "IMG_0001.jpg"
    assert stored.read_bytes() == body
    assert list(tus_temp_on_other_filesystem.iterdir()) == []


def test_same_name_in_another_folder_is_listed(
    client: TestClient, account: dict[str, Any]
) -> None:
    """A root upload whose name already exists in a folder is renamed, not lost."""
    device_token = register_device(client, account)
    backup_folder = client.portal.call(
        user_service.add_folder, account["username"], "Pixel 相簿備份", "file"
    )
    native_upload(client, device_token, "IMG_0002.jpg", b"backup copy", backup_folder)

    native_upload(client, device_token, "IMG_0002.jpg", b"manual copy")

    listed = {
        (entry["name"], entry["folder_id"]) for entry in dashboard_files(client, account)
    }
    assert listed == {("IMG_0002.jpg", backup_folder), ("IMG_0002_1.jpg", None)}
    root = settings.paths.upload_folder / account["folder"]
    assert (root / "IMG_0002_1.jpg").read_bytes() == b"manual copy"


def test_failed_finalization_is_not_reported_as_success(
    client: TestClient, account: dict[str, Any]
) -> None:
    """When the file cannot be placed, the last PATCH fails and HEAD forgets it.

    The worker treats a 204 on the last chunk as "completed"; a finalisation
    error after that left the job green while nothing was listed.
    """
    device_token = register_device(client, account)
    folder_id = client.portal.call(
        user_service.add_folder, account["username"], "Gone", "file"
    )
    body = b"orphan"
    location = native_create(client, device_token, "orphan.jpg", len(body), folder_id)
    assert client.portal.call(user_service.delete_folder, account["username"], folder_id)

    patched = native_patch(client, location, body)

    assert patched.status_code >= 400, patched.text
    assert client.head(location, headers=TUS_HEADERS).status_code in (404, 410)
    assert dashboard_files(client, account) == []


def test_failed_dedup_link_keeps_the_upload(
    client: TestClient, account: dict[str, Any], tus_temp_on_other_filesystem: Path
) -> None:
    """A duplicate whose hardlink cannot be created must stay on disk."""
    device_token = register_device(client, account)
    body = b"same-content-" + os.urandom(16)
    # An index entry on another filesystem makes os.link fail with EXDEV.
    foreign_copy = tus_temp_on_other_filesystem / "elsewhere.bin"
    foreign_copy.write_bytes(body)
    digest = hashlib.sha256(body).hexdigest()
    dedup_service._hash_map[digest] = str(foreign_copy)
    try:
        native_upload(client, device_token, "dup.jpg", body)
    finally:
        dedup_service._hash_map.pop(digest, None)

    stored = settings.paths.upload_folder / account["folder"] / "dup.jpg"
    assert stored.read_bytes() == body
    assert [entry["name"] for entry in dashboard_files(client, account)] == ["dup.jpg"]


def test_recover_stranded_uploads_imports_completed_temp_files(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Uploads the old server marked completed but never imported are recovered.

    Before the fix a failed finalisation left the bytes in ``tus_temp`` with a
    ``completed`` session; recovery imports exactly those files once.
    """
    from backend.routes.tus import metadata_store, recover_stranded_uploads

    device_token = register_device(client, account)
    body = b"stranded-" + os.urandom(8)
    location = native_create(client, device_token, "stranded.jpg", len(body))
    upload_id = location.rsplit("/", 1)[-1]
    # State left behind by the pre-fix server: all bytes, status completed.
    (settings.paths.tus_temp_folder / upload_id).write_bytes(body)
    metadata_store.update_offset(upload_id, len(body), [])
    metadata_store.mark_completed(upload_id)
    assert dashboard_files(client, account) == []

    planned = client.portal.call(recover_stranded_uploads, True)
    assert upload_id in planned
    assert dashboard_files(client, account) == []

    recovered = client.portal.call(recover_stranded_uploads, False)

    assert upload_id in recovered
    assert [entry["name"] for entry in dashboard_files(client, account)] == ["stranded.jpg"]
    assert not (settings.paths.tus_temp_folder / upload_id).exists()
    assert upload_id not in client.portal.call(recover_stranded_uploads, False)
