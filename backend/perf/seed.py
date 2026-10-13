"""Seed deterministic FileNexus workloads without touching production storage."""

import asyncio
import io
import os
import random
import sqlite3
from datetime import datetime
from pathlib import Path
from typing import Any

from PIL import Image


def environment(data_dir: Path, repository: Path) -> dict[str, str]:
    """Return isolated configuration for a benchmark subprocess.

    Args:
        data_dir: Disposable absolute workload directory.
        repository: Import root for the measured checkout.

    Returns:
        Complete environment, with every persistent path redirected.
    """
    environment_values = dict(os.environ)
    paths = {
        "UPLOAD_FOLDER": data_dir / "uploads",
        "USER_INFO_FILE": data_dir / "user_info.json",
        "TUS_TEMP_FOLDER": data_dir / "tus_temp",
        "STATIC_DIR": data_dir / "static",
        "USERS_DB": data_dir / "users.db",
        "NOTES_DB": data_dir / "notes.db",
        "FILES_DB": data_dir / "files.db",
    }
    environment_values.update(
        {f"PATHS__{key}": str(value) for key, value in paths.items()}
    )
    environment_values["PYTHONPATH"] = str(repository)
    # Exercise enabled middleware without benchmarking quota rejections.
    environment_values["RATE_LIMIT__DEFAULT_LIMIT"] = "1000000/minute"
    environment_values["RATE_LIMIT__TUS_LIMIT"] = "1000000/minute"
    return environment_values


async def seed(data_dir: Path) -> dict[str, Any]:
    """Create five users, 200 nested folders, 5,000 files and 2,000 notes.

    Args:
        data_dir: Empty disposable storage directory.

    Returns:
        Request inputs and folder placements for reconciliation restoration.
    """
    from backend.config import settings
    from backend.core.auth import generate_salt, hash_password
    from backend.services.database import close_all, init_db

    await init_db()
    await close_all()
    random_generator = random.Random(20261013)
    timestamp = datetime(2026, 10, 13, 0, 0).isoformat()
    salt = generate_salt()
    password_hash = hash_password("benchmark-password", salt)
    with sqlite3.connect(settings.paths.users_db) as database:
        database.executemany(
            "INSERT INTO users(username,folder,salt,hashed_password,is_locked,first_login) "
            "VALUES (?,?,?,?,?,0)",
            [
                (
                    f"perf-{index}",
                    f"disk-{index}",
                    salt,
                    password_hash,
                    int(index == 0),
                )
                for index in range(5)
            ],
        )
        user_id = database.execute(
            "SELECT id FROM users WHERE username='perf-0'"
        ).fetchone()[0]
        folder_paths: list[list[str]] = []
        for index in range(200):
            depth = index % 10
            names = [
                f"folder-{ancestor:03}"
                for ancestor in range(index - depth, index + 1)
            ]
            folder_paths.append(names)
            database.execute(
                "INSERT INTO folders(id,user_id,name,type,parent_id,is_locked) VALUES(?,?,?,'file',?,?)",
                (
                    f"f-{index:03}",
                    user_id,
                    names[-1],
                    f"f-{index - 1:03}" if depth else None,
                    int(index == 190),
                ),
            )
    for index in range(5):
        (data_dir / "uploads" / f"disk-{index}").mkdir(
            parents=True, exist_ok=True
        )
    image_buffer = io.BytesIO()
    Image.frombytes(
        "RGB", (640, 480), random_generator.randbytes(640 * 480 * 3)
    ).save(image_buffer, format="JPEG", quality=75)
    image_content = image_buffer.getvalue()
    other_content = random_generator.randbytes(16 * 1024)
    file_rows: list[tuple[Any, ...]] = []
    image_names: list[str] = []
    filenames: list[str] = []
    placements: list[tuple[str, str]] = []
    for index in range(4999):
        folder_index = index % 200
        filename = (
            f"file-{index:05}.jpg" if index % 4 == 0 else f"file-{index:05}.bin"
        )
        content = image_content if index % 4 == 0 else other_content
        destination = (
            data_dir / "uploads" / "disk-0" / Path(*folder_paths[folder_index])
        )
        destination.mkdir(parents=True, exist_ok=True)
        (destination / filename).write_bytes(content)
        folder_id = f"f-{folder_index:03}"
        file_rows.append(
            (
                "disk-0",
                filename,
                folder_id,
                len(content),
                timestamp,
                int(index % 101 == 0),
            )
        )
        placements.append((folder_id, filename))
        filenames.append(filename)
        if index % 4 == 0:
            image_names.append(filename)
    large_path = data_dir / "uploads" / "disk-0" / "large-50mb.bin"
    with large_path.open("wb") as output:
        block = random_generator.randbytes(1024 * 1024)
        for _ in range(50):
            output.write(block)
    file_rows.append(
        (
            "disk-0",
            large_path.name,
            None,
            large_path.stat().st_size,
            timestamp,
            0,
        )
    )
    with sqlite3.connect(settings.paths.files_db) as database:
        database.executemany(
            "INSERT INTO files(username,filename,folder_id,size_bytes,created_at,is_locked) VALUES(?,?,?,?,?,?)",
            file_rows,
        )
    with sqlite3.connect(settings.paths.notes_db) as database:
        database.executemany(
            "INSERT INTO urls(username,url,created,is_locked,folder_id) VALUES(?,?,?,?,?)",
            [
                (
                    "perf-0",
                    f"https://example.com/note/{index}?text="
                    + "sample-note-" * 20,
                    timestamp,
                    int(index % 71 == 0),
                    f"f-{index % 200:03}",
                )
                for index in range(2000)
            ],
        )
    (data_dir / "static").mkdir()
    return {
        "images": image_names,
        "batch": filenames[:200],
        "placements": placements,
    }
