"""Tests for ``POST /api/user/{username}/batch-download``."""

import io
import zipfile
from datetime import datetime
from typing import Any, Callable, List

import aiosqlite
import pytest
from fastapi.testclient import TestClient

from backend.services.file_service import file_service
from backend.services.user_service import user_service

USERNAME = "batchuser"
PASSWORD = "batch-pass-123"
FILENAMES = [f"doc{index}.txt" for index in range(6)]
LOCKED_FILENAME = "locked.txt"


async def _seed_user_tree() -> None:
    """Create a user whose files live in a two-level folder hierarchy."""
    await user_service.create_user(USERNAME, PASSWORD)
    parent_id = await user_service.add_folder(USERNAME, "projects", "file")
    child_id = await user_service.add_folder(USERNAME, "2026", "file", parent_id)
    user = await user_service.get_user_by_name(USERNAME)
    path_names = await user_service.get_folder_path_names(USERNAME, child_id)
    folder_path = file_service._get_folder_path(user["folder"], path_names)
    for filename in FILENAMES + [LOCKED_FILENAME]:
        (folder_path / filename).write_text(f"content of {filename}", encoding="utf-8")
        await file_service._register_file(
            user["folder"], filename, 10, datetime.now(), child_id
        )
    await file_service.toggle_file_lock(user["folder"], LOCKED_FILENAME, True)


@pytest.fixture(scope="module")
def seeded_client(client: TestClient) -> TestClient:
    """Return the shared client after seeding the batch-download fixture user.

    Args:
        client: Session-wide TestClient.

    Returns:
        The same client, with test data in place.
    """
    client.portal.call(_seed_user_tree)
    return client


def _batch_download(client: TestClient, filenames: List[str], **form: str) -> Any:
    """POST a batch-download request.

    Args:
        client: TestClient to use.
        filenames: Files to include in the archive.
        **form: Extra form fields (e.g. ``password``).

    Returns:
        The HTTP response.
    """
    return client.post(
        f"/api/user/{USERNAME}/batch-download",
        data={"filenames": filenames, **form},
    )


def test_zip_preserves_folder_hierarchy(seeded_client: TestClient) -> None:
    """Archive entries keep the nested folder path of each file."""
    response = _batch_download(seeded_client, FILENAMES[:2])
    assert response.status_code == 200
    archive = zipfile.ZipFile(io.BytesIO(response.content))
    assert sorted(archive.namelist()) == [
        "projects/2026/doc0.txt",
        "projects/2026/doc1.txt",
    ]
    assert archive.read("projects/2026/doc0.txt") == b"content of doc0.txt"


def test_locked_file_requires_authentication(seeded_client: TestClient) -> None:
    """A locked file in the selection makes the request require credentials."""
    denied = _batch_download(seeded_client, [FILENAMES[0], LOCKED_FILENAME])
    assert denied.status_code == 403

    allowed = _batch_download(
        seeded_client, [FILENAMES[0], LOCKED_FILENAME], password=PASSWORD
    )
    assert allowed.status_code == 200
    assert "projects/2026/locked.txt" in zipfile.ZipFile(
        io.BytesIO(allowed.content)
    ).namelist()


def test_query_count_does_not_grow_with_file_count(
    seeded_client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Metadata is fetched in bulk, so SQL round-trips are O(1) in file count."""
    executed_sql: List[str] = []
    original_execute: Callable[..., Any] = aiosqlite.Connection.execute

    def counting_execute(self: aiosqlite.Connection, sql: str, *args: Any) -> Any:
        executed_sql.append(sql)
        return original_execute(self, sql, *args)

    monkeypatch.setattr(aiosqlite.Connection, "execute", counting_execute)

    assert _batch_download(seeded_client, FILENAMES[:2]).status_code == 200
    queries_for_two_files = len(executed_sql)
    executed_sql.clear()
    assert _batch_download(seeded_client, FILENAMES).status_code == 200
    queries_for_six_files = len(executed_sql)

    assert queries_for_six_files == queries_for_two_files
