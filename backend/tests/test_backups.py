"""Tests for scheduled SQLite backups in ``backend.services.backup_service``."""

import asyncio
import logging
import sqlite3
import threading
import time
from collections.abc import Iterator
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from click.testing import CliRunner
from fastapi.testclient import TestClient

from backend.config import PROJECT_ROOT, BackupConfig, Config
from backend.services.backup_service import (
    BackupError,
    create_backup,
    list_backup_sets,
    run_backup_loop,
)

_BASE_TIME = datetime(2026, 10, 14, 12, 0, 0, tzinfo=timezone.utc)


def _make_wal_db(db_path: Path, rows: list[str]) -> sqlite3.Connection:
    """Create a WAL-mode database whose rows stay in the WAL (not checkpointed).

    Args:
        db_path: Database file to create.
        rows: Text values to insert into table ``t``.

    Returns:
        The still-open writer connection; closing it would checkpoint the WAL.
    """
    conn = sqlite3.connect(str(db_path))
    conn.execute("PRAGMA journal_mode=WAL")
    conn.execute("PRAGMA wal_autocheckpoint=0")
    conn.execute("CREATE TABLE t (value TEXT NOT NULL)")
    conn.executemany("INSERT INTO t (value) VALUES (?)", [(row,) for row in rows])
    conn.commit()
    return conn


@pytest.fixture()
def wal_sources(tmp_path: Path) -> Iterator[dict[str, Path]]:
    """Yield two live WAL databases whose latest commits live only in the WAL.

    Yields:
        Mapping of backup file name to source database path.
    """
    source_dir = tmp_path / "live"
    source_dir.mkdir()
    sources = {"users.db": source_dir / "users.db", "files.db": source_dir / "files.db"}
    writers = [
        _make_wal_db(sources["users.db"], ["alice", "bob"]),
        _make_wal_db(sources["files.db"], ["a.txt"]),
    ]
    try:
        yield sources
    finally:
        for writer in writers:
            writer.close()


def _read_values(db_path: Path) -> list[str]:
    """Return every value of table ``t`` in insertion order.

    Args:
        db_path: Database file to read.

    Returns:
        The stored text values.
    """
    conn = sqlite3.connect(str(db_path))
    try:
        return [row[0] for row in conn.execute("SELECT value FROM t ORDER BY rowid")]
    finally:
        conn.close()


def test_backup_copies_uncheckpointed_wal_data(
    tmp_path: Path, wal_sources: dict[str, Path]
) -> None:
    """A backup set holds every committed row, including rows still in the WAL."""
    backup_dir = tmp_path / "backups"
    set_dir = create_backup(wal_sources, backup_dir, keep=3, now=_BASE_TIME)

    assert set_dir.parent == backup_dir
    assert sorted(path.name for path in set_dir.iterdir()) == ["files.db", "users.db"]
    assert _read_values(set_dir / "users.db") == ["alice", "bob"]
    assert _read_values(set_dir / "files.db") == ["a.txt"]

    # The copy must be a self-contained single file, not a WAL-mode database.
    conn = sqlite3.connect(str(set_dir / "users.db"))
    try:
        assert conn.execute("PRAGMA journal_mode").fetchone()[0] == "delete"
    finally:
        conn.close()
    # Only the finished set is left behind (no temp directories).
    assert [path.name for path in backup_dir.iterdir()] == [set_dir.name]


def test_backup_sets_get_distinct_names_within_one_second(
    tmp_path: Path, wal_sources: dict[str, Path]
) -> None:
    """Two backups taken in the same second must not overwrite each other."""
    backup_dir = tmp_path / "backups"
    first = create_backup(wal_sources, backup_dir, keep=5, now=_BASE_TIME)
    second = create_backup(wal_sources, backup_dir, keep=5, now=_BASE_TIME)

    assert first != second
    assert list_backup_sets(backup_dir) == [first, second]


def test_retention_keeps_newest_sets_and_ignores_foreign_files(
    tmp_path: Path, wal_sources: dict[str, Path]
) -> None:
    """Only the newest ``keep`` sets survive; unrelated entries are never deleted."""
    backup_dir = tmp_path / "backups"
    backup_dir.mkdir()
    foreign_file = backup_dir / "README.txt"
    foreign_file.write_text("keep me", encoding="utf-8")
    foreign_dir = backup_dir / "manual-copy"
    foreign_dir.mkdir()

    created = [
        create_backup(
            wal_sources, backup_dir, keep=3, now=_BASE_TIME + timedelta(hours=hour)
        )
        for hour in range(5)
    ]

    assert list_backup_sets(backup_dir) == created[-3:]
    assert foreign_file.exists()
    assert foreign_dir.is_dir()


def test_missing_source_raises_and_leaves_no_partial_set(
    tmp_path: Path, wal_sources: dict[str, Path]
) -> None:
    """A missing database aborts the set loudly instead of creating an empty copy."""
    backup_dir = tmp_path / "backups"
    missing = tmp_path / "live" / "notes.db"
    sources = {**wal_sources, "notes.db": missing}

    with pytest.raises(BackupError, match="notes.db"):
        create_backup(sources, backup_dir, keep=3, now=_BASE_TIME)

    assert not missing.exists()
    assert list(backup_dir.iterdir()) == []


def test_backup_rejects_non_positive_keep(
    tmp_path: Path, wal_sources: dict[str, Path]
) -> None:
    """``keep`` below one would delete every backup, so it is refused."""
    with pytest.raises(ValueError, match="keep"):
        create_backup(wal_sources, tmp_path / "backups", keep=0, now=_BASE_TIME)


def test_loop_logs_failures_and_keeps_running(caplog: pytest.LogCaptureFixture) -> None:
    """A failing run is logged at error level with a traceback; the loop continues."""
    calls: list[int] = []
    # threading.Event: the backup callable runs in a worker thread.
    done = threading.Event()

    def flaky_backup() -> Path:
        """Fail on the first call, succeed afterwards."""
        calls.append(1)
        if len(calls) == 1:
            raise BackupError("disk full")
        if len(calls) >= 3:
            done.set()
        return Path("/tmp/fake-set")

    async def scenario() -> None:
        """Run the loop until it has completed three iterations, then cancel it."""
        task = asyncio.create_task(
            run_backup_loop(
                flaky_backup, interval_seconds=0.01, initial_delay_seconds=0.0
            )
        )
        deadline = time.monotonic() + 10
        while not done.is_set() and time.monotonic() < deadline:
            await asyncio.sleep(0.01)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task

    with caplog.at_level(logging.INFO, logger="backend.services.backup_service"):
        asyncio.run(scenario())

    assert len(calls) >= 3
    errors = [record for record in caplog.records if record.levelno == logging.ERROR]
    assert len(errors) == 1
    assert errors[0].exc_info is not None
    assert "disk full" in str(errors[0].exc_info[1])


def test_backup_config_defaults_and_env_overrides(
    monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """Backup settings have safe defaults and are overridable via ``BACKUP__*``."""
    defaults = BackupConfig()
    assert defaults.enabled is True
    assert defaults.dir == PROJECT_ROOT / "backups"
    assert defaults.interval_hours == 24.0
    assert defaults.keep == 14
    assert defaults.initial_delay_seconds == 60.0

    monkeypatch.setenv("BACKUP__ENABLED", "false")
    monkeypatch.setenv("BACKUP__DIR", str(tmp_path / "elsewhere"))
    monkeypatch.setenv("BACKUP__INTERVAL_HOURS", "6")
    monkeypatch.setenv("BACKUP__KEEP", "3")
    loaded = Config().backup
    assert loaded.enabled is False
    assert loaded.dir == tmp_path / "elsewhere"
    assert loaded.interval_hours == 6.0
    assert loaded.keep == 3


def test_app_startup_takes_a_backup(client: TestClient) -> None:
    """The application lifespan schedules a backup shortly after startup."""
    from backend.config import settings

    backup_dir = settings.backup.dir
    deadline = time.monotonic() + 15
    while not list_backup_sets(backup_dir) and time.monotonic() < deadline:
        time.sleep(0.1)

    sets = list_backup_sets(backup_dir)
    assert sets, f"no backup set appeared in {backup_dir}"
    assert sorted(path.name for path in sets[-1].iterdir()) == [
        "files.db",
        "notes.db",
        "tus_metadata.db",
        "users.db",
    ]


def test_cli_backup_command_creates_a_set(
    client: TestClient, monkeypatch: pytest.MonkeyPatch, tmp_path: Path
) -> None:
    """``python -m backend.cli backup`` writes one set to the configured directory.

    The ``client`` fixture is requested so the app has created every database.
    """
    from backend.cli import cli
    from backend.config import settings

    target = tmp_path / "cli-backups"
    monkeypatch.setattr(settings.backup, "dir", target)
    result = CliRunner().invoke(cli, ["backup"])

    assert result.exit_code == 0, result.output
    sets = list_backup_sets(target)
    assert len(sets) == 1
    assert str(sets[0]) in result.output
