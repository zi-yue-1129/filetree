"""
User management service backed by SQLite (users.db).

Replaces JSON-based storage with aiosqlite queries for users and folders.
"""

import uuid
from pathlib import Path
from typing import Dict, List, Optional, Set, Tuple
from collections import defaultdict

from backend.config import settings
from backend.core.auth import generate_salt, hash_password, verify_password
from backend.services.database import get_users_db


class UserService:
    """Service for user operations backed by users.db."""

    # ------------------------------------------------------------------
    # User CRUD
    # ------------------------------------------------------------------

    async def get_user_by_name(self, username: str) -> Optional[dict]:
        """Fetch a user by username.

        Args:
            username: The username to find.

        Returns:
            A dict with all user fields if found, None otherwise.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        user = dict(row)
        user["is_locked"] = bool(user["is_locked"])
        user["first_login"] = bool(user["first_login"])
        user["show_in_list"] = bool(user["show_in_list"])
        # Attach folders list
        user["folders"] = await self._get_user_folders(user["id"])
        return user

    async def get_user_by_password(self, password: str) -> Optional[dict]:
        """Authenticate a user by password.

        Args:
            password: The plain text password.

        Returns:
            The user dict if authenticated, None otherwise.
        """
        db = await get_users_db()
        cursor = await db.execute("SELECT * FROM users")
        rows = await cursor.fetchall()
        for row in rows:
            user = dict(row)
            if verify_password(password, user["salt"], user["hashed_password"]):
                user["is_locked"] = bool(user["is_locked"])
                user["first_login"] = bool(user["first_login"])
                user["show_in_list"] = bool(user["show_in_list"])
                user["folders"] = await self._get_user_folders(user["id"])
                return user
        return None

    async def create_user(
        self,
        username: str,
        password: str,
        folder: Optional[str] = None,
    ) -> dict:
        """Create a new user.

        Args:
            username: Unique username.
            password: Plain text password (will be hashed).
            folder: Physical upload folder name. Defaults to username.

        Returns:
            The created user dict.
        """
        salt = generate_salt()
        hashed_pw = hash_password(password, salt)
        folder = folder or username

        db = await get_users_db()
        cursor = await db.execute(
            """INSERT INTO users
               (username, folder, salt, hashed_password, is_locked, first_login,
                data_retention_days, show_in_list)
               VALUES (?, ?, ?, ?, 0, 1, NULL, 1)""",
            (username, folder, salt, hashed_pw),
        )
        await db.commit()

        # Ensure physical folder exists
        path = settings.paths.upload_folder / folder
        path.mkdir(parents=True, exist_ok=True)

        return {
            "id": cursor.lastrowid,
            "username": username,
            "folder": folder,
            "salt": salt,
            "hashed_password": hashed_pw,
            "is_locked": False,
            "first_login": True,
            "data_retention_days": None,
            "show_in_list": True,
            "folders": [],
        }

    async def list_public_users(self) -> List[dict]:
        """List users visible in public list.

        Returns:
            List of user dicts (safe public fields only).
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id, username, folder, is_locked, first_login, "
            "data_retention_days, show_in_list FROM users WHERE show_in_list = 1"
        )
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            user = dict(row)
            user["is_locked"] = bool(user["is_locked"])
            user["first_login"] = bool(user["first_login"])
            user["show_in_list"] = bool(user["show_in_list"])
            result.append(user)
        return result

    async def list_all_users_for_admin(self) -> List[dict]:
        """List ALL users for admin panel.

        Returns:
            List of user dicts (safe public fields).
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id, username, folder, is_locked, first_login, "
            "data_retention_days, show_in_list FROM users"
        )
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            user = dict(row)
            user["is_locked"] = bool(user["is_locked"])
            user["first_login"] = bool(user["first_login"])
            user["show_in_list"] = bool(user["show_in_list"])
            result.append(user)
        return result

    async def list_all_users(self) -> List[dict]:
        """List all users with full info (Admin usage).

        Returns:
            A list of full user dicts.
        """
        db = await get_users_db()
        cursor = await db.execute("SELECT * FROM users")
        rows = await cursor.fetchall()
        result = []
        for row in rows:
            user = dict(row)
            user["is_locked"] = bool(user["is_locked"])
            user["first_login"] = bool(user["first_login"])
            user["show_in_list"] = bool(user["show_in_list"])
            user["folders"] = await self._get_user_folders(user["id"])
            result.append(user)
        return result

    async def update_user(self, username: str, update_data: dict) -> bool:
        """Update specific fields for a user.

        Args:
            username: The user to update.
            update_data: Dictionary of fields to update.

        Returns:
            True if successful, False if user not found.
        """
        if not update_data:
            return True

        # Boolean → int conversion for SQLite
        for key in ("is_locked", "first_login", "show_in_list"):
            if key in update_data and isinstance(update_data[key], bool):
                update_data[key] = int(update_data[key])

        allowed_fields = {
            "is_locked", "first_login", "data_retention_days",
            "show_in_list", "folder", "username",
        }
        filtered = {k: v for k, v in update_data.items() if k in allowed_fields}
        if not filtered:
            return True

        set_clause = ", ".join(f"{k} = ?" for k in filtered)
        values = list(filtered.values()) + [username]

        db = await get_users_db()
        cursor = await db.execute(
            f"UPDATE users SET {set_clause} WHERE username = ?", values
        )
        await db.commit()
        return cursor.rowcount > 0

    async def update_user_profile(
        self,
        old_username: str,
        new_username: Optional[str] = None,
        is_locked: Optional[bool] = None,
    ) -> bool:
        """Advanced user update including renaming and folder sync.

        Args:
            old_username: Current username.
            new_username: New username to set.
            is_locked: Whether to lock the account.

        Returns:
            True if successful.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT * FROM users WHERE username = ?", (old_username,)
        )
        row = await cursor.fetchone()
        if not row:
            return False
        user = dict(row)

        updates: Dict[str, object] = {}

        if new_username and new_username != old_username:
            # Check collision
            dup = await db.execute(
                "SELECT id FROM users WHERE username = ?", (new_username,)
            )
            if await dup.fetchone():
                raise ValueError(f"節點代碼 {new_username} 已被佔用。")

            # Sync folder if named after user
            old_folder = user["folder"]
            if old_folder == old_username:
                old_path = settings.paths.upload_folder / old_folder
                new_path = settings.paths.upload_folder / new_username
                if old_path.exists() and not new_path.exists():
                    old_path.rename(new_path)
                    updates["folder"] = new_username
            updates["username"] = new_username

        if is_locked is not None:
            updates["is_locked"] = int(is_locked)

        if updates:
            set_clause = ", ".join(f"{k} = ?" for k in updates)
            values = list(updates.values()) + [old_username]
            await db.execute(
                f"UPDATE users SET {set_clause} WHERE username = ?", values
            )
            await db.commit()

        return True

    async def reset_password(self, username: str, new_password: str) -> bool:
        """Reset a user's password.

        Args:
            username: The user whose password to reset.
            new_password: The new plain text password.

        Returns:
            True if successful, False if user not found.
        """
        salt = generate_salt()
        hashed_pw = hash_password(new_password, salt)
        db = await get_users_db()
        cursor = await db.execute(
            "UPDATE users SET salt = ?, hashed_password = ?, first_login = 1 "
            "WHERE username = ?",
            (salt, hashed_pw, username),
        )
        await db.commit()
        return cursor.rowcount > 0

    async def delete_user(self, username: str) -> bool:
        """Delete a user and their associated data.

        Args:
            username: The username to delete.

        Returns:
            True if successful, False if not found.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id, folder FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()
        if not row:
            return False

        user_id = row["id"]
        folder = row["folder"]

        # Delete folders (cascade will clean up)
        await db.execute("DELETE FROM folders WHERE user_id = ?", (user_id,))
        await db.execute("DELETE FROM users WHERE id = ?", (user_id,))
        await db.commit()

        # Clean up physical storage
        if folder:
            folder_path = settings.paths.upload_folder / folder
            if folder_path.exists() and folder_path.is_dir():
                import asyncio
                import shutil
                loop = asyncio.get_event_loop()
                await loop.run_in_executor(None, shutil.rmtree, folder_path)

        return True

    # ------------------------------------------------------------------
    # Folder CRUD
    # ------------------------------------------------------------------

    async def _get_user_folders(self, user_id: int) -> List[dict]:
        """Fetch all folders for a user.

        Args:
            user_id: The user's DB ID.

        Returns:
            List of folder dicts.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id, name, type, parent_id, is_locked FROM folders WHERE user_id = ?",
            (user_id,),
        )
        rows = await cursor.fetchall()
        return [{**dict(r), "is_locked": bool(r["is_locked"])} for r in rows]

    async def get_visible_folders_and_hidden_ids(
        self, user_id: str, is_authenticated: bool
    ) -> Tuple[List[dict], Set[str]]:
        """Get visible folders and a set of hidden/locked folder IDs.

        If not authenticated, locked folders and their descendants are hidden.

        Args:
            user_id: The user ID.
            is_authenticated: Whether the requester is authenticated.

        Returns:
            Tuple of (visible_folders_list, hidden_folder_ids_set).
        """
        all_folders = await self._get_user_folders(user_id)
        
        if is_authenticated:
            return all_folders, set()

        # Build tree to find descendants
        children = defaultdict(list)
        for f in all_folders:
            if f["parent_id"]:
                children[f["parent_id"]].append(f["id"])

        hidden_ids = set()
        
        def mark_hidden(fid: str):
            if fid in hidden_ids:
                return
            hidden_ids.add(fid)
            for child_id in children[fid]:
                mark_hidden(child_id)

        # Identify roots of hidden subtrees (locked folders)
        for f in all_folders:
            if f["is_locked"]:
                mark_hidden(f["id"])

        visible = [f for f in all_folders if f["id"] not in hidden_ids]
        return visible, hidden_ids

    async def get_folders_by_username(self, username: str) -> List[dict]:
        """Fetch all folders for a user by username.

        Args:
            username: The username.

        Returns:
            List of folder dicts.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT f.id, f.name, f.type, f.parent_id, f.is_locked "
            "FROM folders f JOIN users u ON f.user_id = u.id "
            "WHERE u.username = ?",
            (username,),
        )
        rows = await cursor.fetchall()
        return [{**dict(r), "is_locked": bool(r["is_locked"])} for r in rows]

    async def add_folder(
        self,
        username: str,
        name: str,
        folder_type: str,
        parent_id: Optional[str] = None,
    ) -> Optional[str]:
        """Add a new folder for a user.

        Args:
            username: The user's name.
            name: Folder name.
            folder_type: 'file' or 'url'.
            parent_id: Optional parent folder ID.

        Returns:
            The new folder ID, or None on failure.
        """
        name = name.strip().replace("/", "_").replace("\\", "_").replace("..", "_")
        if not name:
            raise ValueError("Invalid folder name")

        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id FROM users WHERE username = ?", (username,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        user_id = row["id"]

        # Check duplicate name in same parent
        dup = await db.execute(
            "SELECT id FROM folders WHERE user_id = ? AND name = ? AND "
            "(parent_id = ? OR (parent_id IS NULL AND ? IS NULL))",
            (user_id, name, parent_id, parent_id),
        )
        if await dup.fetchone():
            raise ValueError("Folder name already exists")

        folder_id = str(uuid.uuid4())
        await db.execute(
            "INSERT INTO folders (id, user_id, name, type, parent_id) "
            "VALUES (?, ?, ?, ?, ?)",
            (folder_id, user_id, name, folder_type, parent_id),
        )
        await db.commit()
        return folder_id

    async def update_folder(
        self, username: str, folder_id: str, name: str
    ) -> bool:
        """Update folder metadata.

        Args:
            username: The username.
            folder_id: The folder ID.
            name: New folder name.

        Returns:
            Success status.
        """
        name = name.strip().replace("/", "_").replace("\\", "_").replace("..", "_")
        if not name:
            return False

        db = await get_users_db()
        # Get folder details
        cursor = await db.execute(
            "SELECT f.*, u.username FROM folders f "
            "JOIN users u ON f.user_id = u.id "
            "WHERE f.id = ? AND u.username = ?",
            (folder_id, username),
        )
        row = await cursor.fetchone()
        if not row:
            return False
        folder = dict(row)

        # Check duplicate name in same parent (excluding self)
        dup = await db.execute(
            "SELECT id FROM folders WHERE user_id = ? AND name = ? AND id != ? AND "
            "(parent_id = ? OR (parent_id IS NULL AND ? IS NULL))",
            (folder["user_id"], name, folder_id, folder["parent_id"], folder["parent_id"]),
        )
        if await dup.fetchone():
            return False

        await db.execute(
            "UPDATE folders SET name = ? WHERE id = ?", (name, folder_id)
        )
        await db.commit()
        return True

    async def delete_folder(self, username: str, folder_id: str) -> bool:
        """Delete a folder. Also removes child sub-folders.

        Args:
            username: The user to update.
            folder_id: Folder ID.

        Returns:
            True if successful.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT f.id FROM folders f JOIN users u ON f.user_id = u.id "
            "WHERE f.id = ? AND u.username = ?",
            (folder_id, username),
        )
        if not await cursor.fetchone():
            return False

        # Collect all descendant folder IDs (breadth-first)
        ids_to_delete = [folder_id]
        queue = [folder_id]
        while queue:
            current = queue.pop(0)
            child_cursor = await db.execute(
                "SELECT id FROM folders WHERE parent_id = ?", (current,)
            )
            children = await child_cursor.fetchall()
            for child in children:
                ids_to_delete.append(child["id"])
                queue.append(child["id"])

        # Unassign files in files.db
        from backend.services.database import get_files_db, get_notes_db
        files_db = await get_files_db()
        for fid in ids_to_delete:
            await files_db.execute(
                "UPDATE files SET folder_id = NULL WHERE folder_id = ? AND username = ?",
                (fid, username),
            )
        await files_db.commit()

        # Unassign URLs in notes.db
        notes_db = await get_notes_db()
        for fid in ids_to_delete:
            await notes_db.execute(
                "UPDATE urls SET folder_id = NULL WHERE folder_id = ? AND username = ?",
                (fid, username),
            )
        await notes_db.commit()

        # Delete folders
        placeholders = ",".join("?" for _ in ids_to_delete)
        await db.execute(
            f"DELETE FROM folders WHERE id IN ({placeholders})", ids_to_delete
        )
        await db.commit()
        return True

    async def move_folder(
        self, username: str, folder_id: str, target_parent_id: Optional[str]
    ) -> bool:
        """Move a folder to a new parent.

        Args:
            username: The username.
            folder_id: Folder to move.
            target_parent_id: New parent folder ID (None for root).

        Returns:
            True if successful, False on cycle or not found.
        """
        if folder_id == target_parent_id:
            return False

        db = await get_users_db()
        # Check target is not a descendant of source (prevents cycle)
        if target_parent_id:
            current = target_parent_id
            for _ in range(50):
                cursor = await db.execute(
                    "SELECT parent_id FROM folders WHERE id = ?", (current,)
                )
                row = await cursor.fetchone()
                if not row or not row["parent_id"]:
                    break
                if row["parent_id"] == folder_id:
                    return False  # Cycle detected
                current = row["parent_id"]

        await db.execute(
            "UPDATE folders SET parent_id = ? WHERE id = ?",
            (target_parent_id, folder_id),
        )
        await db.commit()
        return True

    async def get_folder_path_names(
        self, username: str, folder_id: Optional[str]
    ) -> List[str]:
        """Resolve physical path (list of folder names) for a folder ID.

        Args:
            username: The username.
            folder_id: The folder ID.

        Returns:
            List of folder names from root to target.
        """
        if not folder_id:
            return []

        db = await get_users_db()
        path: List[str] = []
        current_id: Optional[str] = folder_id

        for _ in range(50):  # Max depth safety
            cursor = await db.execute(
                "SELECT name, parent_id FROM folders WHERE id = ?", (current_id,)
            )
            row = await cursor.fetchone()
            if not row:
                break
            path.insert(0, row["name"])
            current_id = row["parent_id"]
            if not current_id:
                break

        return path

    @staticmethod
    def folder_path_names_from_map(
        folders_by_id: Dict[str, dict], folder_id: Optional[str]
    ) -> List[str]:
        """Resolve a folder's path from preloaded folders, without DB queries.

        Mirrors ``get_folder_path_names`` for callers that resolve many
        folders at once (see ``get_folders_by_username``).

        Args:
            folders_by_id: Folder dicts keyed by folder ID.
            folder_id: The folder ID to resolve.

        Returns:
            List of folder names from root to target.
        """
        path: List[str] = []
        current_id = folder_id
        for _ in range(50):  # Max depth safety
            folder = folders_by_id.get(current_id) if current_id else None
            if folder is None:
                break
            path.insert(0, folder["name"])
            current_id = folder["parent_id"]
        return path

    @staticmethod
    def is_folder_chain_locked(
        folders_by_id: Dict[str, dict], folder_id: Optional[str]
    ) -> bool:
        """Check whether a folder or any of its ancestors is locked.

        Walks ``parent_id`` links in preloaded folder data (no DB queries),
        bounded to the same max depth as ``get_folder_path_names``.

        Args:
            folders_by_id: Folder dicts keyed by folder ID, as returned by
                ``get_folders_by_username``.
            folder_id: The folder to start from. ``None`` means the root,
                which cannot be locked.

        Returns:
            True if the folder or any ancestor has ``is_locked`` set.
        """
        current_id = folder_id
        for _ in range(50):  # Max depth safety
            folder = folders_by_id.get(current_id) if current_id else None
            if folder is None:
                return False
            if folder["is_locked"]:
                return True
            current_id = folder["parent_id"]
        return False

    async def get_folder_by_id(self, folder_id: str) -> Optional[dict]:
        """Fetch a single folder by ID.

        Args:
            folder_id: The folder ID.

        Returns:
            Folder dict or None.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT id, user_id, name, type, parent_id, is_locked FROM folders WHERE id = ?",
            (folder_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        result = dict(row)
        result["is_locked"] = bool(result["is_locked"])
        return result

    async def toggle_folder_lock(
        self, username: str, folder_id: str, is_locked: bool
    ) -> bool:
        """Toggle the lock status of a folder.

        Args:
            username: The username.
            folder_id: The folder ID.
            is_locked: New lock status.

        Returns:
            True if successful, False if folder not found.
        """
        db = await get_users_db()
        cursor = await db.execute(
            "SELECT f.id FROM folders f JOIN users u ON f.user_id = u.id "
            "WHERE f.id = ? AND u.username = ?",
            (folder_id, username),
        )
        if not await cursor.fetchone():
            return False

        await db.execute(
            "UPDATE folders SET is_locked = ? WHERE id = ?",
            (int(is_locked), folder_id),
        )
        await db.commit()
        return True


# Singleton instance
user_service = UserService()
