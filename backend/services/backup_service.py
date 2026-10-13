"""Consistent, scheduled backups of the backend's SQLite databases.

Each run writes one *backup set*: a directory named
``filenexus-<UTC timestamp>`` holding a copy of every database. Copies are
taken with SQLite's online backup API, so they are consistent snapshots even
while the server keeps writing (WAL mode), and are converted to rollback
journal mode so each file is self-contained. A set is assembled in a hidden
temporary directory and renamed into place only when complete, so a crash
never leaves a half-written set that looks valid. Only the newest ``keep``
sets are retained; entries in the backup directory that do not look like a
backup set are never touched.

Restoring = stopping the server and copying the ``*.db`` files of one set
back over the live databases (deleting any ``-wal``/``-shm`` files next to
them).
"""

import asyncio
import logging
import os
import re
import shutil
import sqlite3
import threading
import time
from collections.abc import Callable, Mapping
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from backend.config import BackupConfig, settings
from backend.services.tus_metadata_store import DEFAULT_DB_PATH as TUS_DEFAULT_DB_PATH

logger = logging.getLogger(__name__)

_SET_PREFIX = "filenexus-"
_SET_NAME_PATTERN = re.compile(r"^filenexus-(\d{8}T\d{6}Z)(?:-(\d+))?$")
_TMP_PREFIX = ".tmp-"
# Temporary directories older than this are leftovers of a crashed run.
_STALE_TMP_SECONDS = 6 * 3600
_SQLITE_BUSY_TIMEOUT_SECONDS = 30.0

# Serialises backups taken inside one process (scheduler vs. manual trigger).
_backup_lock = threading.Lock()


class BackupError(RuntimeError):
    """Raised when a database backup cannot be produced."""


def default_sources() -> dict[str, Path]:
    """Return every database the server owns, keyed by its backup file name.

    Returns:
        Mapping of file name inside a backup set to the live database path.
    """
    return {
        "users.db": settings.paths.users_db,
        "notes.db": settings.paths.notes_db,
        "files.db": settings.paths.files_db,
        # TusMetadataStore resolves its default path against the CWD.
        "tus_metadata.db": Path(TUS_DEFAULT_DB_PATH).resolve(),
    }


def _set_sort_key(set_dir: Path) -> tuple[str, int]:
    """Order backup sets chronologically (timestamp, then collision suffix).

    Args:
        set_dir: A directory whose name matches the backup set pattern.

    Returns:
        Sort key ``(timestamp, suffix)``.
    """
    match = _SET_NAME_PATTERN.match(set_dir.name)
    if match is None:
        raise ValueError(f"{set_dir} is not a backup set")
    return match.group(1), int(match.group(2) or 0)


def list_backup_sets(backup_dir: Path) -> list[Path]:
    """List completed backup sets, oldest first.

    Args:
        backup_dir: Directory holding backup sets.

    Returns:
        Paths of the backup set directories; empty if ``backup_dir`` does not
        exist yet (no backup has been taken).
    """
    if not backup_dir.exists():
        return []
    sets = [
        entry
        for entry in backup_dir.iterdir()
        if entry.is_dir() and _SET_NAME_PATTERN.match(entry.name)
    ]
    return sorted(sets, key=_set_sort_key)


def _claim_set_name(backup_dir: Path, now: datetime) -> tuple[Path, Path]:
    """Reserve a unique set name by atomically creating its temp directory.

    Args:
        backup_dir: Directory holding backup sets.
        now: Timestamp of the backup.

    Returns:
        ``(temporary_dir, final_dir)``; ``temporary_dir`` already exists.
    """
    stamp = now.astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    suffix = 0
    while True:
        name = f"{_SET_PREFIX}{stamp}" + (f"-{suffix}" if suffix else "")
        final_dir = backup_dir / name
        temp_dir = backup_dir / f"{_TMP_PREFIX}{name}"
        if not final_dir.exists():
            try:
                temp_dir.mkdir()
            except FileExistsError:
                # Another backup (e.g. the CLI) claimed this name; try the next.
                suffix += 1
                continue
            return temp_dir, final_dir
        suffix += 1


def _copy_database(source: Path, destination: Path) -> None:
    """Copy one live SQLite database to ``destination`` consistently.

    Args:
        source: Live database file (may be in WAL mode and in use).
        destination: New file to create.

    Raises:
        BackupError: If the source is missing or the copy fails its check.
    """
    if not source.is_file():
        # Connecting would silently create an empty database instead.
        raise BackupError(f"Database {source} does not exist; cannot back it up")
    source_conn = sqlite3.connect(str(source), timeout=_SQLITE_BUSY_TIMEOUT_SECONDS)
    try:
        dest_conn = sqlite3.connect(str(destination))
        try:
            source_conn.backup(dest_conn)
            # Make the copy a single self-contained file (no -wal/-shm needed).
            dest_conn.execute("PRAGMA journal_mode=DELETE")
            check = dest_conn.execute("PRAGMA quick_check").fetchone()[0]
            if check != "ok":
                raise BackupError(f"Backup of {source} failed quick_check: {check}")
        finally:
            dest_conn.close()
    finally:
        source_conn.close()


def _prune(backup_dir: Path, keep: int) -> None:
    """Delete all but the newest ``keep`` sets and stale temp directories.

    Args:
        backup_dir: Directory holding backup sets.
        keep: Number of newest sets to retain.
    """
    for old_set in list_backup_sets(backup_dir)[:-keep]:
        logger.info("Deleting old backup set %s", old_set)
        shutil.rmtree(old_set)
    stale_before = time.time() - _STALE_TMP_SECONDS
    for entry in backup_dir.iterdir():
        is_leftover = entry.is_dir() and entry.name.startswith(_TMP_PREFIX + _SET_PREFIX)
        if is_leftover and entry.stat().st_mtime < stale_before:
            logger.warning("Deleting unfinished backup set %s from a crashed run", entry)
            shutil.rmtree(entry)


def create_backup(
    sources: Mapping[str, Path],
    backup_dir: Path,
    keep: int,
    now: Optional[datetime] = None,
) -> Path:
    """Write one backup set of ``sources`` and apply the retention policy.

    Args:
        sources: Mapping of file name inside the set to live database path.
        backup_dir: Directory holding backup sets (created if missing).
        keep: Number of newest sets to retain (must be >= 1).
        now: Timestamp naming the set; defaults to the current UTC time.

    Returns:
        Path of the completed backup set directory.

    Raises:
        ValueError: If ``keep`` < 1 or ``sources`` is empty.
        BackupError: If any database cannot be copied; no set is left behind.
        OSError: If the backup directory is not writable.
    """
    if keep < 1:
        raise ValueError(f"keep must be >= 1, got {keep}")
    if not sources:
        raise ValueError("No databases to back up")
    timestamp = now if now is not None else datetime.now(timezone.utc)

    with _backup_lock:
        backup_dir.mkdir(parents=True, exist_ok=True)
        temp_dir, final_dir = _claim_set_name(backup_dir, timestamp)
        try:
            for file_name, source in sources.items():
                _copy_database(Path(source), temp_dir / file_name)
            os.replace(temp_dir, final_dir)
        except BaseException:
            shutil.rmtree(temp_dir)
            raise
        logger.info("Backup set written to %s", final_dir)
        _prune(backup_dir, keep)
    return final_dir


async def run_backup_loop(
    run_once: Callable[[], Path],
    interval_seconds: float,
    initial_delay_seconds: float,
) -> None:
    """Run ``run_once`` in a worker thread periodically until cancelled.

    Args:
        run_once: Blocking callable producing one backup set.
        interval_seconds: Pause between the end of one run and the next.
        initial_delay_seconds: Pause before the first run.
    """
    await asyncio.sleep(initial_delay_seconds)
    while True:
        try:
            await asyncio.to_thread(run_once)
        except Exception:
            # Keep the scheduler alive: a transient failure (backup disk
            # offline, full, locked database) must not stop future backups or
            # the server. The full traceback is logged at error level.
            logger.error("Scheduled database backup failed", exc_info=True)
        await asyncio.sleep(interval_seconds)


def start_backup_task(config: BackupConfig) -> Optional["asyncio.Task[None]"]:
    """Start the periodic backup loop for the running event loop.

    Args:
        config: Backup settings.

    Returns:
        The background task, or ``None`` when backups are disabled.
    """
    if not config.enabled:
        logger.warning("Scheduled database backups are disabled (BACKUP__ENABLED)")
        return None

    def run_once() -> Path:
        """Back up every server database into the configured directory."""
        return create_backup(default_sources(), config.dir, config.keep)

    logger.info(
        "Scheduling database backups to %s every %sh (keeping %d sets)",
        config.dir,
        config.interval_hours,
        config.keep,
    )
    return asyncio.create_task(
        run_backup_loop(
            run_once,
            interval_seconds=config.interval_hours * 3600,
            initial_delay_seconds=config.initial_delay_seconds,
        ),
        name="database-backups",
    )
