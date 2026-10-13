"""Seed a throw-away FileNexus backend data directory for frontend perf runs.

Usage (from the repository root, with the backend virtualenv):

    python frontend/perf/seed_backend.py <data_dir>

Every backend data path is redirected into ``<data_dir>`` through the
``PATHS__*`` environment variables (same mechanism as
``backend/tests/conftest.py``) *before* any backend module is imported. The
caller must start uvicorn with the exact environment printed by
:func:`backend_environment` and with ``<data_dir>`` as working directory
(``TusMetadataStore`` resolves its DB against the CWD).

The data set is deterministic (fixed RNG seed): one user ``perfuser`` with
password ``perf-password-123``, 40 file folders (5 top-level, 35 nested), 600 files (150 JPEG images so
thumbnails load, interleaved with other files), 5 URL folders and 80 URL/note records.
"""

from __future__ import annotations

import asyncio
import io
import json
import os
import random
import sys
from pathlib import Path

PERF_USERNAME = "perfuser"
PERF_PASSWORD = "perf-password-123"
FILE_FOLDER_COUNT = 40
TOP_LEVEL_FOLDERS = 5
FILE_COUNT = 600
IMAGE_COUNT = 150
URL_FOLDER_COUNT = 5
URL_COUNT = 80
RANDOM_SEED = 20261013


def backend_environment(data_dir: Path) -> dict[str, str]:
    """Return the environment variables that point the backend at ``data_dir``.

    Args:
        data_dir: Absolute directory that holds every backend data file.

    Returns:
        Mapping of environment variable names to values.
    """
    data = data_dir / "data"
    return {
        "PATHS__UPLOAD_FOLDER": str(data / "uploads"),
        "PATHS__USER_INFO_FILE": str(data / "user_info.json"),
        "PATHS__TUS_TEMP_FOLDER": str(data / "tus_temp"),
        "PATHS__STATIC_DIR": str(data_dir / "static"),
        "PATHS__USERS_DB": str(data / "users.db"),
        "PATHS__NOTES_DB": str(data / "notes.db"),
        "PATHS__FILES_DB": str(data / "files.db"),
        "RATE_LIMIT__ENABLED": "false",
        "SERVER__DEBUG": "false",
    }


def _make_jpeg(rng: random.Random, index: int) -> bytes:
    """Render a deterministic 800x600 gradient JPEG.

    Args:
        rng: Seeded random generator.
        index: Image index, used to vary the colours.

    Returns:
        Encoded JPEG bytes.
    """
    from PIL import Image, ImageDraw

    width, height = 800, 600
    base_red, base_green, base_blue = rng.randrange(256), rng.randrange(256), rng.randrange(256)
    image = Image.new("RGB", (width, height), (base_red, base_green, base_blue))
    draw = ImageDraw.Draw(image)
    for stripe in range(0, width, 40):
        shade = (stripe * 255) // width
        draw.rectangle(
            [stripe, 0, stripe + 20, height],
            fill=((base_red + shade) % 256, (base_green + index * 7) % 256, (base_blue + shade // 2) % 256),
        )
    draw.ellipse([200, 150, 600, 450], outline=(255, 255, 255), width=6)
    buffer = io.BytesIO()
    image.save(buffer, format="JPEG", quality=80)
    return buffer.getvalue()


async def _seed(data_dir: Path) -> dict[str, object]:
    """Create the user, folders, files and URL records.

    Args:
        data_dir: Absolute directory that holds every backend data file.

    Returns:
        Summary of the seeded data set.
    """
    from backend.services.database import close_all, init_db
    from backend.services.file_service import file_service
    from backend.services.note_service import note_service
    from backend.services.user_service import user_service

    rng = random.Random(RANDOM_SEED)
    await init_db()
    if await user_service.get_user_by_name(PERF_USERNAME):
        raise RuntimeError(f"{data_dir} is already seeded; use an empty directory")

    await user_service.create_user(PERF_USERNAME, PERF_PASSWORD)
    # Skip the forced first-login password change modal.
    await user_service.update_user(PERF_USERNAME, {"first_login": False})

    # A realistic tree: TOP_LEVEL_FOLDERS at the root, the rest nested below
    # them, so the root view shows a few folder cards above the long list.
    folders: list[tuple[str, list[str]]] = []
    top_level: list[tuple[str, str]] = []
    for top_index in range(TOP_LEVEL_FOLDERS):
        name = f"專案 {top_index}"
        folder_id = await user_service.add_folder(PERF_USERNAME, name, "file")
        if folder_id is None:
            raise RuntimeError("add_folder returned None for the perf user")
        top_level.append((folder_id, name))
        folders.append((folder_id, [name]))
    for child_index in range(FILE_FOLDER_COUNT - TOP_LEVEL_FOLDERS):
        parent_id, parent_name = top_level[child_index % TOP_LEVEL_FOLDERS]
        name = f"子資料夾 {child_index:02d}"
        folder_id = await user_service.add_folder(PERF_USERNAME, name, "file", parent_id)
        if folder_id is None:
            raise RuntimeError("add_folder returned None for the perf user")
        folders.append((folder_id, [parent_name, name]))

    extensions = ["pdf", "txt", "zip", "docx", "mp3", "csv", "json", "bin"]
    for file_index in range(FILE_COUNT):
        # Every fourth file is a JPEG so thumbnails are spread over the list
        # (the backend lists files ordered by name).
        is_image = file_index % (FILE_COUNT // IMAGE_COUNT) == 0
        if is_image:
            filename = f"item_{file_index:04d}.jpg"
            content = _make_jpeg(rng, file_index)
        else:
            extension = extensions[file_index % len(extensions)]
            filename = f"item_{file_index:04d}.{extension}"
            content = bytes(rng.getrandbits(8) for _ in range(rng.randint(2_000, 20_000)))
        # A third of the files stay at the root, the rest spread over folders.
        if file_index % 3 == 0:
            await file_service.save_file(PERF_USERNAME, filename, content)
        else:
            folder_id, folder_path = folders[file_index % FILE_FOLDER_COUNT]
            await file_service.save_file(
                PERF_USERNAME, filename, content, folder_path_names=folder_path, folder_id=folder_id
            )

    url_folder_ids = []
    for folder_index in range(URL_FOLDER_COUNT):
        folder_id = await user_service.add_folder(PERF_USERNAME, f"筆記 {folder_index}", "url")
        url_folder_ids.append(folder_id)
    for url_index in range(URL_COUNT):
        if url_index % 2 == 0:
            record = f"https://example.com/articles/{url_index}?ref=perf"
        else:
            record = f"會議筆記 #{url_index}：" + "這是一段測試用的筆記內容。" * rng.randint(1, 6)
        folder_id = url_folder_ids[url_index % URL_FOLDER_COUNT] if url_index % 4 else None
        await note_service.add_url(PERF_USERNAME, record, folder_id)

    await close_all()
    return {
        "username": PERF_USERNAME,
        "password": PERF_PASSWORD,
        "files": FILE_COUNT,
        "images": IMAGE_COUNT,
        "file_folders": FILE_FOLDER_COUNT,
        "urls": URL_COUNT,
    }


def main() -> None:
    """Parse arguments, redirect backend paths and seed the data set."""
    if len(sys.argv) != 2:
        raise SystemExit("usage: seed_backend.py <empty data dir>")
    data_dir = Path(sys.argv[1]).resolve()
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "static").mkdir(exist_ok=True)
    os.environ.update(backend_environment(data_dir))
    os.chdir(data_dir)
    repo_root = Path(__file__).resolve().parents[2]
    sys.path.insert(0, str(repo_root))
    summary = asyncio.run(_seed(data_dir))
    sys.stdout.write(json.dumps({"summary": summary, "env": backend_environment(data_dir)}) + "\n")


if __name__ == "__main__":
    main()
