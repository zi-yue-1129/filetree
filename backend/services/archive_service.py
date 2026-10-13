"""Bounded archive creation outside the event loop, with disk-backed responses."""

import asyncio
import tempfile
import zipfile
from pathlib import Path
from typing import Sequence

from starlette.concurrency import run_in_threadpool

# Avoid twenty simultaneous compressors and large disk queues on small hosts.
_archive_slots = asyncio.Semaphore(2)
_COMPRESSED_EXTENSIONS = frozenset({
    ".jpg", ".jpeg", ".png", ".gif", ".webp", ".mp4", ".mov", ".mkv",
    ".webm", ".zip", ".gz", ".bz2", ".xz", ".7z",
})


def _write_archive(entries: Sequence[tuple[Path, str]]) -> Path:
    """Build a temporary zip, removing it if any write fails."""
    with tempfile.NamedTemporaryFile(suffix=".zip", delete=False) as temporary:
        archive_path = Path(temporary.name)
    try:
        with zipfile.ZipFile(archive_path, "w", zipfile.ZIP_DEFLATED, compresslevel=1) as archive:
            for file_path, archive_name in entries:
                if file_path.is_file():
                    compression = (zipfile.ZIP_STORED if file_path.suffix.lower() in _COMPRESSED_EXTENSIONS else zipfile.ZIP_DEFLATED)
                    archive.write(file_path, arcname=archive_name, compress_type=compression)
    except BaseException:
        archive_path.unlink(missing_ok=True)
        raise
    return archive_path


async def create_archive(entries: Sequence[tuple[Path, str]]) -> Path:
    """Create an archive with bounded CPU concurrency and no event-loop disk work.

    Args:
        entries: Physical source paths and archive-relative names, preauthorized.

    Returns:
        Temporary archive path; the response must delete it after transmission.
    """
    async with _archive_slots:
        return await run_in_threadpool(_write_archive, entries)
