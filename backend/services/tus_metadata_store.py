"""
TUS Upload Metadata Store

Manages persistent storage of TUS upload metadata to enable resume functionality.
Uses SQLite for simplicity and reliability.
"""

import sqlite3
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Dict, List, Any, Iterator
from contextlib import contextmanager
import logging
import threading

logger = logging.getLogger(__name__)

# Relative to the process working directory (/app inside the container).
DEFAULT_DB_PATH = "data/tus_metadata.db"


class TusMetadataStore:
    """Stores TUS upload metadata for fingerprint-based resume detection."""

    def __init__(self, db_path: str = DEFAULT_DB_PATH) -> None:
        """Initialize the metadata store.
        
        Args:
            db_path: Path to SQLite database file.
        """
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self._connection: Optional[sqlite3.Connection] = None
        self._connection_lock = threading.RLock()
        self._init_db()
    
    def _init_db(self) -> None:
        """Initialize database schema."""
        with self._get_connection() as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS tus_uploads (
                    id TEXT PRIMARY KEY,
                    fingerprint TEXT NOT NULL,
                    username TEXT NOT NULL,
                    offset INTEGER NOT NULL DEFAULT 0,
                    size INTEGER NOT NULL,
                    filename TEXT NOT NULL,
                    content_type TEXT,
                    metadata TEXT,
                    parts TEXT,
                    status TEXT NOT NULL DEFAULT 'active',
                    created_at TIMESTAMP NOT NULL,
                    updated_at TIMESTAMP NOT NULL,
                    UNIQUE(fingerprint, username)
                )
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_fingerprint_user 
                ON tus_uploads(fingerprint, username)
            """)
            
            conn.execute("""
                CREATE INDEX IF NOT EXISTS idx_created_at 
                ON tus_uploads(created_at)
            """)
            
            conn.commit()
    
    @contextmanager
    def _get_connection(self) -> Iterator[sqlite3.Connection]:
        """Get database connection with context manager."""
        with self._connection_lock:
            if self._connection is None:
                self._connection = sqlite3.connect(
                    str(self.db_path), timeout=30.0, check_same_thread=False
                )
                self._connection.execute("PRAGMA journal_mode=WAL")
                self._connection.row_factory = sqlite3.Row
            try:
                yield self._connection
            except BaseException:
                self._connection.rollback()
                raise

    def close(self) -> None:
        """Close the serialized worker connection at application shutdown."""
        with self._connection_lock:
            if self._connection is not None:
                self._connection.close()
                self._connection = None

    def create_upload(
        self,
        upload_id: str,
        fingerprint: str,
        username: str,
        size: int,
        filename: str,
        content_type: Optional[str] = None,
        metadata: Optional[Dict[str, Any]] = None
    ) -> Optional[Dict[str, Any]]:
        """Create a new upload record.
        
        Args:
            upload_id: TUS upload ID.
            fingerprint: File fingerprint for resume detection.
            username: Username of the uploader.
            size: Total file size in bytes.
            filename: Original filename.
            content_type: MIME type.
            metadata: Additional metadata dict.
        
        Returns:
            Created upload record dict, or None if concurrently removed.

        Raises:
            sqlite3.Error: When the session cannot be persisted.
        """
        now = datetime.now(timezone.utc).isoformat(sep=" ")
        
        with self._get_connection() as conn:
            try:
                conn.execute("""
                    INSERT OR REPLACE INTO tus_uploads (
                        id, fingerprint, username,
                        offset, size, filename, content_type, metadata,
                        parts, status, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    upload_id,
                    fingerprint,
                    username,
                    0,
                    size,
                    filename,
                    content_type,
                    json.dumps(metadata or {}),
                    json.dumps([]),
                    'active',
                    now,
                    now
                ))
                conn.commit()
            except Exception as e:
                logger.error(f"Failed to create upload record: {e}")
                raise
        
        return self.get_upload(upload_id)
    
    def get_upload(self, upload_id: str) -> Optional[Dict[str, Any]]:
        """Get upload record by ID."""
        with self._get_connection() as conn:
            row = conn.execute(
                "SELECT * FROM tus_uploads WHERE id = ?",
                (upload_id,)
            ).fetchone()
            
            if not row:
                return None
            
            return self._row_to_dict(row)
    
    def get_upload_by_fingerprint(
        self,
        fingerprint: str,
        username: str
    ) -> Optional[Dict[str, Any]]:
        """Get active upload by fingerprint and username (enables refresh-resume).
        
        Args:
            fingerprint: File fingerprint.
            username: Username.
        
        Returns:
            Upload record dict or None.
        """
        with self._get_connection() as conn:
            row = conn.execute("""
                SELECT * FROM tus_uploads 
                WHERE fingerprint = ? AND username = ? AND status = 'active'
                ORDER BY created_at DESC
                LIMIT 1
            """, (fingerprint, username)).fetchone()
            
            if not row:
                return None
            
            return self._row_to_dict(row)
    
    def update_offset(
        self,
        upload_id: str,
        offset: int,
        parts: Optional[List[Dict[str, Any]]] = None
    ) -> bool:
        """Update upload offset and parts list."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE tus_uploads 
                SET offset = ?, parts = ?, updated_at = ?
                WHERE id = ?
            """, (
                offset,
                json.dumps(parts) if parts is not None else None,
                datetime.now(timezone.utc).isoformat(sep=" "),
                upload_id
            ))
            conn.commit()
            return cursor.rowcount > 0
    
    def mark_completed(self, upload_id: str) -> bool:
        """Mark upload as completed."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE tus_uploads 
                SET status = 'completed', updated_at = ?
                WHERE id = ?
            """, (datetime.now(timezone.utc).isoformat(sep=" "), upload_id))
            conn.commit()
            return cursor.rowcount > 0
    
    def mark_aborted(self, upload_id: str) -> bool:
        """Mark upload as aborted."""
        with self._get_connection() as conn:
            cursor = conn.execute("""
                UPDATE tus_uploads 
                SET status = 'aborted', updated_at = ?
                WHERE id = ?
            """, (datetime.now(timezone.utc).isoformat(sep=" "), upload_id))
            conn.commit()
            return cursor.rowcount > 0
    
    def delete_upload(self, upload_id: str) -> bool:
        """Delete upload record."""
        with self._get_connection() as conn:
            cursor = conn.execute(
                "DELETE FROM tus_uploads WHERE id = ?",
                (upload_id,)
            )
            conn.commit()
            return cursor.rowcount > 0
    
    def cleanup_old_uploads(self, days: int = 7) -> int:
        """Clean up old completed/aborted uploads."""
        cutoff = datetime.now(timezone.utc).timestamp() - (days * 24 * 3600)
        
        with self._get_connection() as conn:
            cursor = conn.execute("""
                DELETE FROM tus_uploads 
                WHERE status IN ('completed', 'aborted') 
                AND julianday(created_at) < julianday(?, 'unixepoch')
            """, (cutoff,))
            conn.commit()
            return cursor.rowcount
    
    def cleanup_stale_uploads(self, days: int = 1) -> List[str]:
        """Clean up active uploads older than X days.
        
        Args:
            days: Retention period in days.
            
        Returns:
            List of upload IDs that were deleted.
        """
        cutoff = datetime.now(timezone.utc).timestamp() - (days * 24 * 3600)
        
        deleted_ids = []
        with self._get_connection() as conn:
            # Select stale active uploads
            rows = conn.execute("""
                SELECT id FROM tus_uploads 
                WHERE status = 'active' 
                AND julianday(updated_at) < julianday(?, 'unixepoch')
            """, (cutoff,)).fetchall()
            
            expired_ids = [row['id'] for row in rows]
            
            if expired_ids:
                # Delete them
                placeholders = ','.join('?' for _ in expired_ids)
                conn.execute(f"""
                    DELETE FROM tus_uploads 
                    WHERE id IN ({placeholders})
                """, expired_ids)
                conn.commit()
                deleted_ids = expired_ids
        
        return deleted_ids
    
    def _row_to_dict(self, row: sqlite3.Row) -> Dict[str, Any]:
        """Convert SQLite row to dictionary."""
        return {
            'id': row['id'],
            'fingerprint': row['fingerprint'],
            'username': row['username'],
            # r2_upload_id and r2_key are legacy/unused, omitted from dict
            'offset': row['offset'],
            'size': row['size'],
            'filename': row['filename'],
            'content_type': row['content_type'],
            'metadata': json.loads(row['metadata']) if row['metadata'] else {},
            'parts': json.loads(row['parts']) if row['parts'] else [],
            'status': row['status'],
            'created_at': row['created_at'],
            'updated_at': row['updated_at']
        }
