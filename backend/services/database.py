"""
Database layer for the FileNexus backend.

Manages 3 independent SQLite databases via aiosqlite:
- users.db: User accounts, credentials, and folder structures.
- notes.db: URL/note records.
- files.db: File index and metadata.
"""

import aiosqlite
import logging
from pathlib import Path
from typing import Optional

from backend.config import settings

logger = logging.getLogger(__name__)

# Module-level connection singletons.
_users_conn: Optional[aiosqlite.Connection] = None
_notes_conn: Optional[aiosqlite.Connection] = None
_files_conn: Optional[aiosqlite.Connection] = None

# ------------------------------------------------------------------
# Schema Definitions
# ------------------------------------------------------------------

USERS_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    folder TEXT NOT NULL,
    salt TEXT NOT NULL,
    hashed_password TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    first_login INTEGER NOT NULL DEFAULT 1,
    data_retention_days INTEGER,
    show_in_list INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS devices (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_name TEXT NOT NULL,
    platform TEXT NOT NULL CHECK (platform IN ('android', 'ios', 'windows', 'macos')),
    token_hash TEXT NOT NULL UNIQUE,
    push_token TEXT,
    created_at TEXT NOT NULL,
    last_seen_at TEXT NOT NULL,
    revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id);

-- Session/access/share tokens; only SHA-256 hashes are stored.
CREATE TABLE IF NOT EXISTS auth_tokens (
    token_hash TEXT PRIMARY KEY,
    username TEXT NOT NULL,
    filename TEXT,
    token_type TEXT NOT NULL,
    expires_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_expires_at ON auth_tokens(expires_at);

CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'file',
    parent_id TEXT,
    is_locked INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES folders(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_folders_user_id ON folders(user_id);
CREATE INDEX IF NOT EXISTS idx_folders_parent_id ON folders(parent_id);
CREATE INDEX IF NOT EXISTS idx_folders_user_parent ON folders(user_id, parent_id);
"""

NOTES_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS urls (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    url TEXT NOT NULL,
    created TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    folder_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_urls_username ON urls(username);
CREATE INDEX IF NOT EXISTS idx_urls_username_folder ON urls(username, folder_id);
CREATE INDEX IF NOT EXISTS idx_urls_username_created ON urls(username, created DESC);
"""

FILES_DB_SCHEMA = """
CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL,
    filename TEXT NOT NULL,
    folder_id TEXT,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    is_locked INTEGER NOT NULL DEFAULT 0,
    UNIQUE(username, filename)
);

CREATE INDEX IF NOT EXISTS idx_files_username ON files(username);
CREATE INDEX IF NOT EXISTS idx_files_username_folder ON files(username, folder_id);
CREATE INDEX IF NOT EXISTS idx_files_username_filename ON files(username, filename);
"""


# ------------------------------------------------------------------
# Connection Management
# ------------------------------------------------------------------

async def _open_connection(db_path: Path) -> aiosqlite.Connection:
    """Open a connection with WAL mode and FK enforcement.

    Args:
        db_path: Absolute path to the SQLite database file.

    Returns:
        An open aiosqlite connection.
    """
    conn = await aiosqlite.connect(str(db_path))
    conn.row_factory = aiosqlite.Row
    await conn.execute("PRAGMA journal_mode=WAL")
    await conn.execute("PRAGMA foreign_keys=ON")
    # Wait up to 15s for a competing writer instead of raising "database is locked".
    await conn.execute("PRAGMA busy_timeout=15000")
    return conn


async def get_users_db() -> aiosqlite.Connection:
    """Return the singleton connection for users.db."""
    global _users_conn
    if _users_conn is None:
        _users_conn = await _open_connection(settings.paths.users_db)
    return _users_conn


async def get_notes_db() -> aiosqlite.Connection:
    """Return the singleton connection for notes.db."""
    global _notes_conn
    if _notes_conn is None:
        _notes_conn = await _open_connection(settings.paths.notes_db)
    return _notes_conn


async def get_files_db() -> aiosqlite.Connection:
    """Return the singleton connection for files.db."""
    global _files_conn
    if _files_conn is None:
        _files_conn = await _open_connection(settings.paths.files_db)
    return _files_conn


# ------------------------------------------------------------------
# Initialization
# ------------------------------------------------------------------

async def init_db() -> None:
    """Create all tables in all 3 databases if they don't exist."""
    users_db = await get_users_db()
    await users_db.executescript(USERS_DB_SCHEMA)
    await users_db.commit()
    logger.info("users.db initialized.")

    notes_db = await get_notes_db()
    await notes_db.executescript(NOTES_DB_SCHEMA)
    await notes_db.commit()
    logger.info("notes.db initialized.")

    files_db = await get_files_db()
    await files_db.executescript(FILES_DB_SCHEMA)
    await files_db.commit()
    logger.info("files.db initialized.")


async def close_all() -> None:
    """Close all open database connections."""
    global _users_conn, _notes_conn, _files_conn
    for conn in (_users_conn, _notes_conn, _files_conn):
        if conn:
            await conn.close()
    _users_conn = _notes_conn = _files_conn = None
    logger.info("All database connections closed.")
