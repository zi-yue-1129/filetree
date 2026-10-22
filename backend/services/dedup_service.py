"""Hash uploaded files in worker threads and reuse duplicate disk content."""

import os
import hashlib
import asyncio
from pathlib import Path
from typing import Optional, Dict
from backend.config import settings

class DedupService:
    """Maintain a content hash index for optional hardlink deduplication."""

    def __init__(self) -> None:
        """Load the persisted content index without starting background work."""
        self.index_file = settings.paths.tus_temp_folder.parent / "file_index.txt"
        self._hash_map: Dict[str, str] = {} # hash -> file_path (one of the copies)
        self._load_index()

    def _load_index(self) -> None:
        """Load hash index from file (simple persistence)."""
        if self.index_file.exists():
            try:
                with open(self.index_file, "r", encoding="utf-8") as f:
                    for line in f:
                        parts = line.strip().split("|")
                        if len(parts) == 2:
                            self._hash_map[parts[0]] = parts[1]
            except Exception as e:
                print(f"Error loading dedup index: {e}")

    def _save_index(self) -> None:
        """Save hash index to file."""
        try:
            with open(self.index_file, "w", encoding="utf-8") as f:
                for h, p in self._hash_map.items():
                    f.write(f"{h}|{p}\n")
        except Exception as e:
            print(f"Error saving dedup index: {e}")

    def calculate_hash(self, file_path: Path) -> str:
        """Calculate SHA-256 hash of a file."""
        sha256_hash = hashlib.sha256()
        with file_path.open("rb") as f:
            for byte_block in iter(lambda: f.read(1024 * 1024), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()

    async def deduplicate(self, file_path: Path) -> bool:
        """
        Check if file is a duplicate. If so, replace with hardlink.
        If not, index it.
        Returns True if deduplicated (space saved), False otherwise.
        """
        try:
            # 1. Calculate Hash
            # Offload to thread to avoid blocking event loop
            loop = asyncio.get_event_loop()
            file_hash = await loop.run_in_executor(None, self.calculate_hash, file_path)

            # 2. Check Index
            existing_path_str = self._hash_map.get(file_hash)
            
            if existing_path_str:
                existing_path = Path(existing_path_str)
                
                # Check if existing file still exists
                if existing_path.exists():
                    # Check if they are already the same inode (already hardlinked)
                    if os.path.samefile(file_path, existing_path):
                        return True

                    # 3. Deduplicate!
                    # Remove the new file and replace with hardlink to existing
                    print(f"Deduplicating {file_path.name} -> {existing_path.name}")
                    # Link beside the file first and swap atomically, so a link
                    # that fails (EXDEV, no hardlink support) never deletes it.
                    link_path = file_path.with_name(f".{file_path.name}.dedup-link")
                    try:
                        os.link(existing_path, link_path)
                    except OSError:
                        link_path.unlink(missing_ok=True)
                        raise
                    os.replace(link_path, file_path)
                    return True
                else:
                    # Stale index, update it
                    self._hash_map[file_hash] = str(file_path)
                    self._save_index()
                    return False
            else:
                # New unique file
                self._hash_map[file_hash] = str(file_path)
                self._save_index()
                return False

        except Exception as e:
            print(f"Deduplication error for {file_path}: {e}")
            return False

    async def scan_existing_files(self, upload_folder: Optional[Path] = None) -> dict:
        """
        Scan all existing files and deduplicate them.
        Returns stats: {'scanned': int, 'deduplicated': int, 'space_saved_bytes': int}
        """
        if upload_folder is None:
            upload_folder = settings.paths.upload_folder
        
        stats = {'scanned': 0, 'deduplicated': 0, 'space_saved_bytes': 0}
        
        print(f"Starting deduplication scan of {upload_folder}...")
        
        for user_folder in upload_folder.iterdir():
            if not user_folder.is_dir():
                continue
            
            for file_path in user_folder.iterdir():
                if not file_path.is_file():
                    continue
                
                stats['scanned'] += 1
                file_size = file_path.stat().st_size
                
                if await self.deduplicate(file_path):
                    stats['deduplicated'] += 1
                    stats['space_saved_bytes'] += file_size
                
                if stats['scanned'] % 100 == 0:
                    print(f"  Scanned {stats['scanned']} files...")
        
        print(f"Scan complete: {stats['scanned']} files scanned, {stats['deduplicated']} deduplicated")
        print(f"Space saved: {stats['space_saved_bytes'] / (1024*1024):.2f} MB")
        
        return stats

dedup_service = DedupService()

