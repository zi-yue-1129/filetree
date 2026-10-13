"""Regressions for backend payload, media caching and bounded upload work."""

import asyncio
import io
import sqlite3
import warnings
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from PIL import Image
from starlette.requests import Request

from backend.config import PushConfig, settings
from backend.services.file_service import file_service
from backend.services.token_service import token_service
from backend.tests.test_devices import bearer, metadata


def upload_fixture(
    client: TestClient, account: dict[str, Any], filename: str, content: bytes
) -> str:
    """Seed an indexed file and return its owner's session credential.

    Args:
        client: Started application client.
        account: Isolated account.
        filename: File name.
        content: File bytes.

    Returns:
        Owner token.
    """
    client.portal.call(
        file_service.save_file, account["folder"], filename, content
    )
    return token_service.create_session_token(account["username"])


def image_bytes(color: str = "red") -> bytes:
    """Encode a real image for thumbnail and invalidation checks.

    Args:
        color: Image fill.

    Returns:
        PNG bytes.
    """
    buffer = io.BytesIO()
    Image.new("RGB", (400, 400), color).save(buffer, format="PNG")
    return buffer.getvalue()


def test_json_compression_preserves_dashboard(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Compress large JSON while preserving its exact decoded dashboard contract."""
    token = upload_fixture(client, account, "payload.bin", b"content")
    for index in range(20):
        client.portal.call(
            file_service.save_file,
            account["folder"],
            f"file-{index}.bin",
            b"content",
        )
    path = f"/api/user/{account['username']}"
    plain = client.get(
        path, headers={**bearer(token), "Accept-Encoding": "identity"}
    )
    compressed = client.get(
        path, headers={**bearer(token), "Accept-Encoding": "gzip"}
    )
    assert compressed.status_code == 200
    assert compressed.headers.get("Content-Encoding") == "gzip"
    assert "Accept-Encoding" in compressed.headers["Vary"]
    assert int(compressed.headers["Content-Length"]) < len(plain.content) / 2
    assert compressed.json() == plain.json()
    assert set(compressed.json()) == {
        "user",
        "usage",
        "files",
        "urls",
        "folders",
    }


def test_download_range_is_never_compressed(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Keep binary and JSON-file downloads byte-identical, including ranges."""
    content = b'{"text":"' + b"x" * 4096 + b'"}'
    token = upload_fixture(client, account, "large.json", content)
    path = f"/api/download/{account['username']}/large.json"
    whole = client.get(
        path, headers={**bearer(token), "Accept-Encoding": "gzip"}
    )
    assert whole.content == content
    assert "Content-Encoding" not in whole.headers
    partial = client.get(
        path,
        headers={
            **bearer(token),
            "Accept-Encoding": "gzip",
            "Range": "bytes=17-42",
        },
    )
    assert partial.status_code == 206
    assert partial.content == content[17:43]
    assert "Content-Encoding" not in partial.headers


def test_thumbnail_conditional_auth_and_invalidation(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Validate after authorization, reject stale validators and avoid public caches."""
    token = upload_fixture(client, account, "photo.png", image_bytes())
    path = f"/api/thumbnail/{account['username']}/photo.png"
    original = client.get(path, headers=bearer(token))
    assert original.status_code == 200
    validator = original.headers["ETag"]
    conditional = client.get(
        path, headers={**bearer(token), "If-None-Match": validator}
    )
    assert conditional.status_code == 304
    assert conditional.content == b""
    assert conditional.headers["ETag"] == validator
    assert original.headers["Cache-Control"] == "private, no-cache"
    weak = client.get(
        path,
        headers={
            **bearer(token),
            "If-None-Match": f'"unrelated", W/{validator}',
        },
    )
    assert weak.status_code == 304
    denied = client.get(path, headers={"If-None-Match": validator})
    assert denied.status_code == 403
    source = settings.paths.upload_folder / account["folder"] / "photo.png"
    source.write_bytes(image_bytes("blue"))
    changed = client.get(
        path, headers={**bearer(token), "If-None-Match": validator}
    )
    assert changed.status_code == 200
    assert changed.headers["ETag"] != validator
    assert changed.content != original.content


def test_thumbnail_opt_in_immutable_version(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Only a matching content version opts into long private cache lifetime."""
    token = upload_fixture(client, account, "version.png", image_bytes())
    path = f"/api/thumbnail/{account['username']}/version.png"
    original = client.get(path, headers=bearer(token))
    version = original.headers["ETag"].strip('"')
    matched = client.get(
        path, params={"version": version}, headers=bearer(token)
    )
    assert (
        matched.headers["Cache-Control"]
        == "private, max-age=31536000, immutable"
    )
    stale = client.get(path, params={"version": "stale"}, headers=bearer(token))
    assert stale.headers["Cache-Control"] == "private, no-cache"


def test_thumbnail_generation_coalesces(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Concurrent requests for one uncached image share one generation task."""
    from backend.services.thumbnail_service import ThumbnailService

    source = tmp_path / "image.png"
    source.write_bytes(image_bytes())
    service = ThumbnailService()
    calls: list[int] = []
    process_image = service._process_image

    def counted(input_path: Path, output_path: Path) -> None:
        """Count actual image decoding operations."""
        calls.append(1)
        process_image(input_path, output_path)

    monkeypatch.setattr(service, "_process_image", counted)

    async def exercise() -> list[str | None]:
        """Issue twenty concurrent service requests in the application event loop."""
        return await asyncio.gather(
            *(service.get_thumbnail(source) for _ in range(20))
        )

    paths = client.portal.call(exercise)
    assert all(path == paths[0] and path is not None for path in paths)
    assert len(calls) == 1


def test_push_debounce_setting(monkeypatch: pytest.MonkeyPatch) -> None:
    """Expose a validated 30-second default and honor a short environment override."""
    from backend.config import Config
    from backend.services.push_service import PushService

    assert PushConfig().debounce_seconds == 30.0
    monkeypatch.setenv("PUSH__DEBOUNCE_SECONDS", "0.01")
    configured = Config.load()
    assert configured.push.debounce_seconds == 0.01
    monkeypatch.setattr(settings.push, "debounce_seconds", 0.01)
    assert PushService(None).debounce_seconds == 0.01
    with pytest.raises(ValueError):
        PushConfig(debounce_seconds=-1)


def test_tus_timestamps_explicit_and_legacy(tmp_path: Path) -> None:
    """New writes use explicit aware UTC text; preexisting adapter strings still load."""
    from backend.services.tus_metadata_store import TusMetadataStore

    store = TusMetadataStore(str(tmp_path / "metadata.db"))
    with warnings.catch_warnings(record=True) as observed:
        warnings.simplefilter("always", DeprecationWarning)
        created = store.create_upload(
            "new", "new-fingerprint", "user", 2, "file"
        )
        assert created is not None
        store.update_offset("new", 1, [])
        store.mark_completed("new")
        store.mark_aborted("new")
        store.cleanup_old_uploads()
        store.cleanup_stale_uploads()
    assert not [
        warning
        for warning in observed
        if issubclass(warning.category, DeprecationWarning)
    ]
    assert datetime.fromisoformat(created["created_at"]).tzinfo == timezone.utc
    with sqlite3.connect(store.db_path) as database:
        database.execute(
            "UPDATE tus_uploads SET created_at=?,updated_at=?,status='active' WHERE id='new'",
            ("2020-01-01 12:34:56.123456", "2020-01-01 12:34:56.123456"),
        )
    legacy = store.get_upload("new")
    assert legacy is not None
    assert legacy["created_at"] == "2020-01-01 12:34:56.123456"
    assert store.cleanup_stale_uploads(days=1) == ["new"]


def test_tus_patch_streams_without_request_body(
    client: TestClient, account: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """PATCH must consume the ASGI stream without buffering the complete request."""
    token = token_service.create_session_token(account["username"])
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "10",
            "Upload-Metadata": metadata(filename="stream.bin", token=token),
        },
    )
    original_body = Request.body

    async def forbid_patch_body(request: Request) -> bytes:
        """Reject whole-body reads while allowing other JSON/form endpoints."""
        if request.method == "PATCH":
            raise AssertionError("TUS PATCH buffered its complete body")
        return await original_body(request)

    monkeypatch.setattr(Request, "body", forbid_patch_body)
    patched = client.patch(
        created.headers["Location"],
        content=b"12345",
        headers={**bearer(token), "Upload-Offset": "0"},
    )
    assert patched.status_code == 204
    assert patched.headers["Upload-Offset"] == "5"
    assert "Content-Encoding" not in patched.headers
    resumed = client.head(created.headers["Location"], headers=bearer(token))
    assert resumed.headers["Upload-Offset"] == "5"


def test_tus_rejects_length_mismatch_and_rolls_back(
    client: TestClient, account: dict[str, Any]
) -> None:
    """A short declared chunk does not leave partial disk bytes or advance metadata."""
    from backend.routes.tus import metadata_store

    token = token_service.create_session_token(account["username"])
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "10",
            "Upload-Metadata": metadata(filename="rollback.bin", token=token),
        },
    )
    location = created.headers["Location"]
    rejected = client.patch(
        location,
        content=b"abc",
        headers={**bearer(token), "Upload-Offset": "0", "Content-Length": "5"},
    )
    assert rejected.status_code == 400
    upload_id = location.rsplit("/", 1)[1]
    assert metadata_store.get_upload(upload_id)["offset"] == 0
    assert (settings.paths.tus_temp_folder / upload_id).stat().st_size == 0
    accepted = client.patch(
        location,
        content=b"12345",
        headers={**bearer(token), "Upload-Offset": "0"},
    )
    assert accepted.status_code == 204


@pytest.mark.parametrize("archive_kind", ["batch", "folder"])
def test_archive_creation_runs_off_event_loop(
    client: TestClient,
    account: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    archive_kind: str,
) -> None:
    """Archive compression cannot block concurrent API and WebSocket processing."""
    import threading
    import zipfile
    from backend.services.user_service import user_service

    folder_id = client.portal.call(
        user_service.add_folder, account["username"], "archives", "file"
    )
    client.portal.call(
        file_service.save_file,
        account["folder"],
        "archive.txt",
        b"payload" * 200,
        ["archives"],
        folder_id,
    )
    token = token_service.create_session_token(account["username"])
    event_loop_thread = client.portal.call(threading.get_ident)
    archive_threads: list[int] = []
    original_write = zipfile.ZipFile.write

    def tracked_write(
        archive: zipfile.ZipFile,
        filename: Any,
        arcname: Any = None,
        compress_type: Any = None,
        compresslevel: Any = None,
    ) -> None:
        """Record the actual archive writer thread without replacing compression."""
        archive_threads.append(threading.get_ident())
        original_write(archive, filename, arcname, compress_type, compresslevel)

    monkeypatch.setattr(zipfile.ZipFile, "write", tracked_write)
    if archive_kind == "batch":
        response = client.post(
            f"/api/user/{account['username']}/batch-download",
            data={"filenames": ["archive.txt"]},
            headers=bearer(token),
        )
    else:
        response = client.get(
            f"/api/user/{account['username']}/folders/{folder_id}/download",
            headers=bearer(token),
        )
    assert response.status_code == 200
    assert archive_threads and event_loop_thread not in archive_threads
    with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
        assert archive.read("archives/archive.txt") == b"payload" * 200


def test_reconciliation_batches_index_repairs(
    client: TestClient, tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Rebuild missing rows in a batch and delete stale rows without N single writes."""
    from backend.services.database import get_files_db
    from backend.services.file_service import FileService

    user_directory = tmp_path / "reconcile-user"
    user_directory.mkdir()
    for index in range(10):
        (user_directory / f"file-{index}").write_bytes(b"disk")
    database = client.portal.call(get_files_db)
    client.portal.call(
        database.execute,
        "INSERT INTO files(username,filename,size_bytes,created_at) VALUES('reconcile-user','stale',1,'2026-01-01')",
    )
    client.portal.call(database.commit)
    statements: list[str] = []
    original_execute = database.execute

    async def tracked_execute(sql: str, parameters: Any = ()) -> Any:
        """Count single-row writes while forwarding SQL to the actual database."""
        statements.append(sql)
        return await original_execute(sql, parameters)

    monkeypatch.setattr(database, "execute", tracked_execute)
    result = client.portal.call(FileService(tmp_path).reconcile_all_users)
    assert result == {"inserted": 10, "deleted": 1, "users_scanned": 1}
    assert not [
        sql for sql in statements if sql.startswith(("INSERT", "DELETE"))
    ]


@pytest.mark.parametrize(
    ("database_name", "query", "parameters", "index_name"),
    [
        (
            "files_db",
            "SELECT * FROM files WHERE username=? AND folder_id=?",
            ("user", "folder"),
            "idx_files_username_folder",
        ),
        (
            "notes_db",
            "SELECT * FROM urls WHERE username=? AND folder_id=?",
            ("user", "folder"),
            "idx_urls_username_folder",
        ),
        (
            "notes_db",
            "SELECT * FROM urls WHERE username=? ORDER BY created DESC",
            ("user",),
            "idx_urls_username_created",
        ),
        (
            "users_db",
            "SELECT * FROM folders WHERE user_id=? AND parent_id=?",
            (1, "folder"),
            "idx_folders_user_parent",
        ),
    ],
)
def test_hot_query_uses_covering_filter_index(
    client: TestClient,
    database_name: str,
    query: str,
    parameters: tuple[Any, ...],
    index_name: str,
) -> None:
    """Hot folder filters use both keys and note listing avoids temporary sorting."""
    with sqlite3.connect(getattr(settings.paths, database_name)) as database:
        plan = [
            row[3]
            for row in database.execute(
                "EXPLAIN QUERY PLAN " + query, parameters
            )
        ]
    assert any(index_name in description for description in plan)
    assert not any("TEMP B-TREE" in description for description in plan)


def test_hash_reads_in_bounded_large_blocks(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Keep SHA-256 exact while avoiding millions of tiny reads for large uploads."""
    import hashlib
    from backend.services.dedup_service import DedupService

    path = tmp_path / "hash-input.bin"
    content = bytes(range(256)) * (16 * 1024)
    path.write_bytes(content)
    read_sizes: list[int] = []
    original_open = Path.open

    class RecordingReader:
        """Read a real file while recording requested buffer sizes."""

        def __init__(self, wrapped: Any) -> None:
            """Retain the file object."""
            self.wrapped = wrapped

        def __enter__(self) -> "RecordingReader":
            """Enter the underlying context."""
            self.wrapped.__enter__()
            return self

        def __exit__(self, *arguments: Any) -> None:
            """Close the underlying context."""
            self.wrapped.__exit__(*arguments)

        def read(self, size: int) -> bytes:
            """Record a read while forwarding to the file."""
            read_sizes.append(size)
            return self.wrapped.read(size)

    def recorded_open(source: Path, *arguments: Any, **keywords: Any) -> Any:
        """Wrap only the measured hash input."""
        opened = original_open(source, *arguments, **keywords)
        return RecordingReader(opened) if source == path else opened

    monkeypatch.setattr(Path, "open", recorded_open)
    digest = DedupService().calculate_hash(path)
    assert digest == hashlib.sha256(content).hexdigest()
    assert read_sizes and len(read_sizes) <= 5


def test_dashboard_loads_folder_tree_once(
    client: TestClient, account: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """A dashboard reuses the loaded folder tree for lock visibility checks."""
    from backend.services.database import get_users_db

    token = token_service.create_session_token(account["username"])
    database = client.portal.call(get_users_db)
    original_execute = database.execute
    folder_queries: list[str] = []

    async def tracked_execute(sql: str, parameters: Any = ()) -> Any:
        """Count actual folder selects while forwarding all database calls."""
        if "FROM folders WHERE user_id" in sql:
            folder_queries.append(sql)
        return await original_execute(sql, parameters)

    monkeypatch.setattr(database, "execute", tracked_execute)
    response = client.get(
        f"/api/user/{account['username']}", headers=bearer(token)
    )
    assert response.status_code == 200
    assert len(folder_queries) == 1


def test_cross_origin_clients_can_read_thumbnail_validator(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Native/web fetch clients can read additive cache and range response headers."""
    token = upload_fixture(client, account, "cross-origin.png", image_bytes())
    response = client.get(
        f"/api/thumbnail/{account['username']}/cross-origin.png",
        headers={**bearer(token), "Origin": "capacitor://localhost"},
    )
    assert response.status_code == 200
    exposed = {
        name.strip().lower()
        for name in response.headers["Access-Control-Expose-Headers"].split(",")
    }
    assert {
        "etag",
        "cache-control",
        "content-range",
        "accept-ranges",
    } <= exposed


def test_parallel_tus_chunks_serialize_offsets(
    client: TestClient, account: dict[str, Any]
) -> None:
    """Only one concurrent PATCH can commit bytes at a given offset."""
    import httpx
    from typing import AsyncIterator
    from backend.app import app
    from backend.routes.tus import metadata_store

    token = token_service.create_session_token(account["username"])
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "6",
            "Upload-Metadata": metadata(filename="parallel.bin", token=token),
        },
    )
    location = created.headers["Location"]

    async def delayed_body() -> AsyncIterator[bytes]:
        """Yield two network fragments with a scheduling point between them."""
        yield b"a"
        await asyncio.sleep(0.02)
        yield b"bc"

    async def exercise() -> list[int]:
        """Race real ASGI requests in the running application's event loop."""
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), timeout=5
        ) as asynchronous_client:
            responses = await asyncio.gather(
                *(
                    asynchronous_client.patch(
                        location,
                        content=delayed_body(),
                        headers={
                            **bearer(token),
                            "Upload-Offset": "0",
                            "Content-Length": "3",
                        },
                    )
                    for _ in range(2)
                )
            )
        return sorted(response.status_code for response in responses)

    assert client.portal.call(exercise) == [204, 409]
    upload_id = location.rsplit("/", 1)[1]
    assert metadata_store.get_upload(upload_id)["offset"] == 3
    assert (settings.paths.tus_temp_folder / upload_id).read_bytes() == b"abc"


def test_disconnected_tus_chunk_rolls_back(
    client: TestClient, account: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> None:
    """Disconnect after a partial write preserves the acknowledged offset and bytes."""
    from typing import AsyncIterator
    from starlette.requests import ClientDisconnect
    from backend.routes.tus import metadata_store

    token = token_service.create_session_token(account["username"])
    created = client.post(
        "/api/upload/tus",
        headers={
            "Upload-Length": "10",
            "Upload-Metadata": metadata(filename="disconnect.bin", token=token),
        },
    )
    location = created.headers["Location"]
    assert (
        client.patch(
            location,
            content=b"first",
            headers={**bearer(token), "Upload-Offset": "0"},
        ).status_code
        == 204
    )
    original_stream = Request.stream

    async def disconnecting_stream(request: Request) -> AsyncIterator[bytes]:
        """Emulate an ASGI disconnect after the first fragment."""
        if request.method == "PATCH":
            yield b"sec"
            raise ClientDisconnect()
        async for fragment in original_stream(request):
            yield fragment

    monkeypatch.setattr(Request, "stream", disconnecting_stream)
    response = client.patch(
        location,
        content=b"other",
        headers={**bearer(token), "Upload-Offset": "5"},
    )
    assert response.status_code == 499
    upload_id = location.rsplit("/", 1)[1]
    assert metadata_store.get_upload(upload_id)["offset"] == 5
    assert (settings.paths.tus_temp_folder / upload_id).read_bytes() == b"first"


def test_reconciliation_does_not_hide_unreadable_files(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A permission error must abort reconciliation instead of deleting valid rows."""
    from backend.services.file_service import FileService

    source = tmp_path / "unreadable.bin"
    source.write_bytes(b"indexed")
    original_stat = Path.stat

    def failing_stat(path: Path, *arguments: Any, **keywords: Any) -> Any:
        """Fail only the source file's stat operation."""
        if path == source:
            raise PermissionError("Unreadable indexed file")
        return original_stat(path, *arguments, **keywords)

    monkeypatch.setattr(Path, "stat", failing_stat)
    with pytest.raises(PermissionError, match="Unreadable indexed file"):
        FileService._scan_disk_files_sync(tmp_path)


@pytest.mark.parametrize("endpoint", ["thumbnail", "download"])
def test_nested_media_paths_have_constant_query_count(
    client: TestClient,
    account: dict[str, Any],
    monkeypatch: pytest.MonkeyPatch,
    endpoint: str,
) -> None:
    """Resolve nested media placement and locks from the already-loaded folder tree."""
    import aiosqlite
    from backend.services.user_service import user_service

    parent_id = None
    names = []
    for index in range(8):
        name = f"depth-{index}"
        parent_id = client.portal.call(
            user_service.add_folder,
            account["username"],
            name,
            "file",
            parent_id,
        )
        names.append(name)
    client.portal.call(
        file_service.save_file,
        account["folder"],
        "deep.png",
        image_bytes(),
        names,
        parent_id,
    )
    token = token_service.create_session_token(account["username"])
    statements: list[str] = []
    original_execute = aiosqlite.Connection.execute

    def tracked_execute(
        database: aiosqlite.Connection, sql: str, *arguments: Any
    ) -> Any:
        """Count actual queries across the two databases."""
        statements.append(sql)
        return original_execute(database, sql, *arguments)

    monkeypatch.setattr(aiosqlite.Connection, "execute", tracked_execute)
    response = client.get(
        f"/api/{endpoint}/{account['username']}/deep.png", headers=bearer(token)
    )
    assert response.status_code == 200
    assert len(statements) <= 3
