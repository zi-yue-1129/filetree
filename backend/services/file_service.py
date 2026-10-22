"""
File management service backed by SQLite (files.db) and physical disk.

Replaces os.walk-based listing with DB index queries.  Physical file
operations (save/delete/rename/move) are followed by matching DB updates.
Reconciliation on startup syncs disk ↔ DB.
"""

import asyncio
import os
import shutil
import tempfile
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Dict, List, NamedTuple, Optional, Sequence, Set

import aiofiles.os
import logging

from backend.config import settings
from backend.services.database import get_files_db

logger = logging.getLogger(__name__)


class FileAccessRecord(NamedTuple):
    """Placement and effective lock state of an indexed file.

    Attributes:
        folder_id: The folder holding the file, or None for the user root.
        is_locked: True if the file itself or any ancestor folder is locked.
    """

    folder_id: Optional[str]
    is_locked: bool


class FileService:
    """Service for file-related operations backed by files.db."""

    def __init__(self, upload_base: Path = settings.paths.upload_folder) -> None:
        """Initialize the service.

        Args:
            upload_base: The base directory for uploads.
        """
        self.upload_base = upload_base

    # ------------------------------------------------------------------
    # Path helpers
    # ------------------------------------------------------------------

    def _get_user_base_folder(self, username: str) -> Path:
        """Get the absolute path to a user's root upload folder.

        Args:
            username: The username (or folder name).

        Returns:
            The Path object for the base folder.
        """
        path = self.upload_base / username
        path.mkdir(parents=True, exist_ok=True)
        return path

    def _get_folder_path(
        self, username: str, folder_path_names: List[str]
    ) -> Path:
        """Get the absolute path for a specific subfolder path.

        Args:
            username: The username.
            folder_path_names: List of folder names from root to target.

        Returns:
            The absolute Path object.
        """
        path = self._get_user_base_folder(username)
        for name in folder_path_names:
            path = path / name
        path.mkdir(parents=True, exist_ok=True)
        return path

    # ------------------------------------------------------------------
    # DB-backed file listing (replaces os.walk)
    # ------------------------------------------------------------------

    async def get_user_files(
        self,
        username: str,
        retention_days: Optional[int] = None,
        excluded_folder_ids: Optional[Set[str]] = None,
        include_locked: bool = True,
    ) -> List[dict]:
        """Fetch all files for a user from the DB index.

        Args:
            username: The username (folder field value).
            retention_days: Optional custom retention period.

        Returns:
            A list of file info dicts.
        """
        if retention_days is None:
            retention_days = settings.logic.file_retention_days

        db = await get_files_db()
        cursor = await db.execute(
            "SELECT * FROM files WHERE username = ? ORDER BY filename",
            (username,),
        )
        rows = await cursor.fetchall()

        files = []
        current_time = datetime.now()
        retention_interval = timedelta(days=retention_days)
        for row in rows:
            r = dict(row)
            # Skip if file is in an excluded folder
            if excluded_folder_ids and r["folder_id"] in excluded_folder_ids:
                continue
                
            # Skip if file is locked and we don't include locked
            if not include_locked and r["is_locked"]:
                continue
                
            created_time = datetime.fromisoformat(r["created_at"])
            size_bytes = r["size_bytes"]

            if retention_days == 0:
                remaining_days = -1
                remaining_hours = 0
                remaining_minutes = 0
                expired = False
            else:
                expiry_time = created_time + retention_interval
                remaining = expiry_time - current_time
                remaining_days = max(0, remaining.days)
                remaining_hours = max(0, remaining.seconds // 3600)
                remaining_minutes = max(0, (remaining.seconds % 3600) // 60)
                expired = remaining.total_seconds() <= 0

            files.append({
                "name": r["filename"],
                "size": round(size_bytes / (1024 * 1024), 2),
                "size_bytes": size_bytes,
                "created": created_time.strftime("%Y-%m-%d %H:%M:%S"),
                "remaining_days": remaining_days,
                "remaining_hours": remaining_hours,
                "remaining_minutes": remaining_minutes,
                "expired": expired,
                "is_locked": bool(r["is_locked"]),
                "folder_id": r["folder_id"],
            })

        return files

    # ------------------------------------------------------------------
    # DB registration helpers
    # ------------------------------------------------------------------

    async def _register_file(
        self,
        username: str,
        filename: str,
        size_bytes: int,
        created_at: datetime,
        folder_id: Optional[str] = None,
    ) -> None:
        """Insert a file record into the DB index.

        Args:
            username: The username.
            filename: The filename.
            size_bytes: File size in bytes.
            created_at: Creation/upload timestamp.
            folder_id: Optional folder ID.
        """
        db = await get_files_db()
        await db.execute(
            "INSERT INTO files (username, filename, folder_id, size_bytes, "
            "created_at, is_locked) VALUES (?, ?, ?, ?, ?, 0)",
            (username, filename, folder_id, size_bytes,
             created_at.isoformat()),
        )
        await db.commit()

    async def _deregister_file(self, username: str, filename: str) -> None:
        """Remove a file record from the DB index.

        Args:
            username: The username.
            filename: The filename.
        """
        db = await get_files_db()
        await db.execute(
            "DELETE FROM files WHERE username = ? AND filename = ?",
            (username, filename),
        )
        await db.commit()

    async def _is_indexed(self, username: str, filename: str) -> bool:
        """Report whether the account index already has a file of this name.

        ``files`` is unique on ``(username, filename)`` across all folders, so
        a name that is free on disk in one folder may still be taken.

        Args:
            username: The username (folder field value).
            filename: Candidate file name.

        Returns:
            True when a row with this name exists.
        """
        db = await get_files_db()
        cursor = await db.execute(
            "SELECT 1 FROM files WHERE username = ? AND filename = ? LIMIT 1",
            (username, filename),
        )
        return await cursor.fetchone() is not None

    async def _unique_filename(
        self,
        username: str,
        folder: Path,
        filename: str,
        own_name: Optional[str] = None,
    ) -> str:
        """Pick ``name``, ``name_1``, ... free on disk and in the account index.

        Args:
            username: The username (folder field value).
            folder: Destination directory.
            filename: Desired file name (already a basename).
            own_name: Indexed name of the file being moved, which may keep it.

        Returns:
            A name that neither exists in ``folder`` nor in another index row.
        """
        name, ext = os.path.splitext(filename)
        candidate = filename
        counter = 1
        while (folder / candidate).exists() or (
            candidate != own_name and await self._is_indexed(username, candidate)
        ):
            candidate = f"{name}_{counter}{ext}"
            counter += 1
        return candidate

    # ------------------------------------------------------------------
    # File operations (disk + DB)
    # ------------------------------------------------------------------

    async def save_file(
        self,
        username: str,
        filename: str,
        content: bytes,
        folder_path_names: Optional[List[str]] = None,
        folder_id: Optional[str] = None,
    ) -> str:
        """Save a new file and register it in DB.

        Args:
            username: The username.
            filename: The original filename.
            content: The file content in bytes.
            folder_path_names: Optional physical subpath.
            folder_id: Optional folder ID for DB.

        Returns:
            The final unique filename.
        """
        filename = os.path.basename(filename)
        folder = self._get_folder_path(username, folder_path_names or [])
        unique_name = await self._unique_filename(username, folder, filename)

        async with aiofiles.open(folder / unique_name, mode="wb") as f:
            await f.write(content)

        stat = (folder / unique_name).stat()

        # Register in DB
        await self._register_file(
            username, unique_name, stat.st_size,
            datetime.fromtimestamp(stat.st_mtime), folder_id,
        )

        # Trigger deduplication
        from backend.services.dedup_service import dedup_service
        try:
            await dedup_service.deduplicate(folder / unique_name)
        except Exception as e:
            logger.warning(f"Dedup failed: {e}")

        return unique_name

    async def delete_file(
        self,
        username: str,
        filename: str,
        folder_path_names: Optional[List[str]] = None,
    ) -> bool:
        """Delete a specific file from disk and DB.

        Args:
            username: The username.
            filename: The name of the file to delete.
            folder_path_names: Optional physical subpath.

        Returns:
            True if deleted, False if not found.
        """
        filename = os.path.basename(filename)
        folder = self._get_folder_path(username, folder_path_names or [])
        filepath = folder / filename
        if filepath.exists() and filepath.is_file():
            await aiofiles.os.remove(filepath)
            await self._deregister_file(username, filename)
            return True
        # Even if file not on disk, try removing stale DB record
        await self._deregister_file(username, filename)
        return False

    async def rename_file(
        self,
        username: str,
        old_name: str,
        new_name: str,
        folder_path_names: Optional[List[str]] = None,
    ) -> bool:
        """Rename a file on disk and update DB.

        Args:
            username: The username.
            old_name: Current filename.
            new_name: New filename.
            folder_path_names: Optional physical subpath.

        Returns:
            True if successful, False otherwise.
        """
        old_name = os.path.basename(old_name)
        new_name = os.path.basename(new_name)

        folder = self._get_folder_path(username, folder_path_names or [])
        old_path = folder / old_name
        new_path = folder / new_name

        if not old_path.exists() or not old_path.is_file():
            return False
        if new_path.exists():
            return False

        await aiofiles.os.rename(old_path, new_path)

        # Update DB
        db = await get_files_db()
        await db.execute(
            "UPDATE files SET filename = ? WHERE username = ? AND filename = ?",
            (new_name, username, old_name),
        )
        await db.commit()
        return True

    async def move_file(
        self,
        username: str,
        filename: str,
        from_path: List[str],
        to_path: List[str],
        new_folder_id: Optional[str] = None,
    ) -> bool:
        """Physically move a file and update DB folder_id.

        Args:
            username: The username.
            filename: The filename to move.
            from_path: Source physical path names.
            to_path: Destination physical path names.
            new_folder_id: New folder ID in DB.

        Returns:
            True if moved successfully.
        """
        filename = os.path.basename(filename)
        old_folder = self._get_folder_path(username, from_path)
        new_folder = self._get_folder_path(username, to_path)

        if not (old_folder / filename).exists():
            return False

        # Ensure name uniqueness in target (disk and account index)
        target_name = await self._unique_filename(
            username, new_folder, filename, own_name=filename
        )

        await aiofiles.os.rename(old_folder / filename, new_folder / target_name)

        # Update DB
        db = await get_files_db()
        if target_name != filename:
            await db.execute(
                "UPDATE files SET folder_id = ?, filename = ? "
                "WHERE username = ? AND filename = ?",
                (new_folder_id, target_name, username, filename),
            )
        else:
            await db.execute(
                "UPDATE files SET folder_id = ? "
                "WHERE username = ? AND filename = ?",
                (new_folder_id, username, filename),
            )
        await db.commit()
        return True

    async def import_file(
        self,
        source_path: Path,
        username: str,
        filename: str,
        folder_path_names: Optional[List[str]] = None,
        folder_id: Optional[str] = None,
        deduplicate: bool = True,
    ) -> Path:
        """Move a finished upload into the user's folder and index it.

        The source may live on another filesystem: the Windows deployment
        bind-mounts ``tus_temp`` and ``uploads`` separately, where ``rename(2)``
        fails with ``EXDEV``. ``shutil.move`` then copies and deletes instead.

        Args:
            source_path: Path to the source file (will be moved).
            username: The username.
            filename: The original filename.
            folder_path_names: Optional physical subpath.
            folder_id: Optional folder ID for DB.
            deduplicate: Run content deduplication inline; callers that
                schedule it themselves pass False.

        Returns:
            The final path; its name is unique on disk and in the index.

        Raises:
            FileNotFoundError: If ``source_path`` does not exist.
            OSError: If the file cannot be moved or indexed. A file that was
                already moved is removed again so disk and index agree.
        """
        filename = os.path.basename(filename)
        folder = self._get_folder_path(username, folder_path_names or [])

        if not source_path.exists():
            raise FileNotFoundError(f"Upload source is missing: {source_path}")

        unique_name = await self._unique_filename(username, folder, filename)
        target_path = folder / unique_name

        await asyncio.to_thread(shutil.move, str(source_path), str(target_path))
        try:
            stat = target_path.stat()
            await self._register_file(
                username, unique_name, stat.st_size,
                datetime.fromtimestamp(stat.st_mtime), folder_id,
            )
        except BaseException:
            # Keep disk and index consistent: an unindexed file is invisible.
            target_path.unlink(missing_ok=True)
            raise

        if deduplicate:
            from backend.services.dedup_service import dedup_service
            await dedup_service.deduplicate(target_path)

        return target_path

    # ------------------------------------------------------------------
    # Lock management
    # ------------------------------------------------------------------

    async def toggle_file_lock(
        self, username: str, filename: str, is_locked: bool
    ) -> bool:
        """Toggle lock status for a file in the DB.

        Args:
            username: The username.
            filename: The filename.
            is_locked: New lock status.

        Returns:
            True if updated.
        """
        db = await get_files_db()
        cursor = await db.execute(
            "UPDATE files SET is_locked = ? WHERE username = ? AND filename = ?",
            (int(is_locked), username, filename),
        )
        await db.commit()
        return cursor.rowcount > 0

    async def is_file_locked(self, username: str, filename: str) -> bool:
        """Check if a file is locked.

        Args:
            username: The username.
            filename: The filename.

        Returns:
            True if locked.
        """
        db = await get_files_db()
        cursor = await db.execute(
            "SELECT is_locked FROM files WHERE username = ? AND filename = ?",
            (username, filename),
        )
        row = await cursor.fetchone()
        return bool(row["is_locked"]) if row else False

    async def get_file_access_records(
        self,
        user_folder: str,
        username: str,
        filenames: Sequence[str],
        folders_by_id: Optional[Dict[str, dict]] = None,
    ) -> Dict[str, FileAccessRecord]:
        """Bulk-resolve folder placement and effective lock state of files.

        A file is effectively locked when its own ``is_locked`` flag is set or
        when its folder, or any ancestor of that folder, is locked. This is
        the same rule the folder-zip download enforces, and every endpoint
        that gates file content on locks must use it.

        The number of SQL queries is independent of ``len(filenames)``: one
        files.db query per 500 names (SQLite variable limit) plus at most one
        users.db query for the folder tree.

        Args:
            user_folder: The user's storage folder (``files.username`` value).
            username: The account username (owner of the folders).
            filenames: Files to resolve. Duplicates are allowed.
            folders_by_id: Optional preloaded folder dicts keyed by ID (from
                ``user_service.get_folders_by_username``); loaded if omitted.

        Returns:
            Mapping of filename to its access record. Files that are not
            indexed in files.db are absent from the mapping.
        """
        from backend.services.user_service import user_service

        db = await get_files_db()
        rows_by_name: Dict[str, Any] = {}
        unique_filenames = list(dict.fromkeys(filenames))
        for start in range(0, len(unique_filenames), 500):
            chunk = unique_filenames[start:start + 500]
            placeholders = ",".join("?" for _ in chunk)
            cursor = await db.execute(
                "SELECT filename, folder_id, is_locked FROM files "
                f"WHERE username = ? AND filename IN ({placeholders})",
                (user_folder, *chunk),
            )
            for row in await cursor.fetchall():
                rows_by_name[row["filename"]] = row

        if folders_by_id is None:
            folders_by_id = {
                folder["id"]: folder
                for folder in await user_service.get_folders_by_username(username)
            }

        return {
            filename: FileAccessRecord(
                folder_id=row["folder_id"],
                is_locked=bool(row["is_locked"])
                or user_service.is_folder_chain_locked(folders_by_id, row["folder_id"]),
            )
            for filename, row in rows_by_name.items()
        }

    async def is_file_effectively_locked(
        self, user_folder: str, username: str, filename: str
    ) -> bool:
        """Check whether a file is locked directly or through a locked folder.

        Single-file convenience wrapper around ``get_file_access_records``.

        Args:
            user_folder: The user's storage folder (``files.username`` value).
            username: The account username (owner of the folders).
            filename: The file to check.

        Returns:
            True if the file or any folder on its ancestor chain is locked.
            Files not indexed in files.db are reported as unlocked, matching
            ``is_file_locked``.
        """
        records = await self.get_file_access_records(user_folder, username, [filename])
        record = records.get(filename)
        return record.is_locked if record else False

    # ------------------------------------------------------------------
    # Physical folder operations
    # ------------------------------------------------------------------

    async def rename_physical_folder(
        self, username: str, path_to: List[str], old_name: str, new_name: str
    ) -> bool:
        """Rename a physical directory."""
        base = self._get_folder_path(username, path_to)
        old_path = base / old_name
        new_path = base / new_name

        if old_path.exists() and old_path.is_dir() and not new_path.exists():
            await aiofiles.os.rename(old_path, new_path)
            return True
        return False

    async def delete_physical_folder(
        self, username: str, path: List[str]
    ) -> bool:
        """Delete a physical directory recursively."""
        target_path = self._get_folder_path(username, path)
        if target_path.exists() and target_path.is_dir():
            import shutil
            loop = asyncio.get_event_loop()
            await loop.run_in_executor(None, shutil.rmtree, target_path)
            return True
        return False

    # ------------------------------------------------------------------
    # Batch operations
    # ------------------------------------------------------------------

    def create_batch_zip(
        self,
        username: str,
        filenames: List[str],
        folder_path_names: Optional[List[str]] = None,
    ) -> Path:
        """Create a temporary zip file containing specified files.

        Args:
            username: The username.
            filenames: List of filenames to include.
            folder_path_names: Optional physical subpath.

        Returns:
            Path to the created temporary zip file.
        """
        user_folder = self._get_folder_path(username, folder_path_names or [])

        temp_zip = tempfile.NamedTemporaryFile(suffix=".zip", delete=False)
        temp_zip_path = Path(temp_zip.name)
        temp_zip.close()

        with zipfile.ZipFile(temp_zip_path, "w", zipfile.ZIP_DEFLATED) as zf:
            for filename in filenames:
                filename = os.path.basename(filename)
                filepath = user_folder / filename
                if filepath.exists() and filepath.is_file():
                    zf.write(filepath, arcname=filename)

        return temp_zip_path

    # ------------------------------------------------------------------
    # Startup reconciliation (disk ↔ DB)
    # ------------------------------------------------------------------

    async def reconcile_all_users(self) -> dict:
        """Scan all user directories and sync disk state with files.db.

        For each user directory under uploads:
        - Files on disk but not in DB → INSERT
        - Files in DB but not on disk → DELETE

        Returns:
            Stats dict with inserted/deleted counts.
        """
        stats = {"inserted": 0, "deleted": 0, "users_scanned": 0}
        loop = asyncio.get_event_loop()

        # Get all user directories
        upload_root = self.upload_base
        if not upload_root.exists():
            return stats

        user_dirs = await loop.run_in_executor(
            None, lambda: [
                d for d in upload_root.iterdir() if d.is_dir()
            ]
        )

        db = await get_files_db()

        for user_dir in user_dirs:
            username = user_dir.name
            stats["users_scanned"] += 1

            # Get all files on disk (recursively), using run_in_executor
            disk_files = await loop.run_in_executor(
                None, self._scan_disk_files_sync, user_dir
            )

            # Get all files in DB for this user
            cursor = await db.execute(
                "SELECT filename FROM files WHERE username = ?", (username,)
            )
            db_rows = await cursor.fetchall()
            db_filenames = {r["filename"] for r in db_rows}

            disk_filenames = {f["filename"] for f in disk_files}

            # Index by name once; repeated linear searches made a rebuild quadratic.
            disk_by_name = {info["filename"]: info for info in disk_files}
            to_insert = disk_filenames - db_filenames
            if to_insert:
                await db.executemany(
                    "INSERT INTO files (username, filename, folder_id, "
                    "size_bytes, created_at, is_locked) VALUES (?, ?, NULL, ?, ?, 0)",
                    [(username, filename, disk_by_name[filename]["size_bytes"],
                      disk_by_name[filename]["created_at"]) for filename in to_insert],
                )
                stats["inserted"] += len(to_insert)
            to_delete = db_filenames - disk_filenames
            if to_delete:
                await db.executemany(
                    "DELETE FROM files WHERE username = ? AND filename = ?",
                    [(username, filename) for filename in to_delete],
                )
                stats["deleted"] += len(to_delete)

        await db.commit()
        logger.info(
            f"Reconciliation complete: scanned {stats['users_scanned']} users, "
            f"inserted {stats['inserted']}, deleted {stats['deleted']}"
        )
        return stats

    @staticmethod
    def _scan_disk_files_sync(user_dir: Path) -> List[dict]:
        """Synchronously scan a user's directory for files.

        Args:
            user_dir: The user's upload directory.

        Returns:
            List of dicts with filename, size_bytes, created_at.
        """
        files = []
        for root, _dirs, filenames in os.walk(user_dir):
            for filename in filenames:
                item = Path(root) / filename
                try:
                    stat = item.stat()
                    files.append({
                        "filename": filename,
                        "size_bytes": stat.st_size,
                        "created_at": datetime.fromtimestamp(
                            stat.st_mtime
                        ).isoformat(),
                    })
                except FileNotFoundError:
                    logger.debug("File disappeared during reconciliation: %s", item)
                    continue
        return files


# Singleton instance
file_service = FileService()
