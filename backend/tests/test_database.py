"""Tests for SQLite connection setup in ``backend.services.database``."""

import asyncio
from pathlib import Path

from backend.services.database import _open_connection


async def _read_pragma(db_path: Path, pragma: str) -> int:
    """Open a connection the way the app does and read one PRAGMA.

    Args:
        db_path: SQLite file to open.
        pragma: PRAGMA name to query.

    Returns:
        The integer value reported by SQLite.
    """
    conn = await _open_connection(db_path)
    try:
        cursor = await conn.execute(f"PRAGMA {pragma}")
        row = await cursor.fetchone()
        return int(row[0])
    finally:
        await conn.close()


def test_connection_waits_on_locked_database(tmp_path: Path) -> None:
    """Connections set busy_timeout so concurrent writers wait instead of failing."""
    busy_timeout_ms = asyncio.run(_read_pragma(tmp_path / "x.db", "busy_timeout"))
    assert busy_timeout_ms == 15000
