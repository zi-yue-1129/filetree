"""Shared pytest fixtures for backend tests.

The backend reads its configuration (and opens SQLite files) at import time,
so every path is redirected to a throwaway directory *before* any ``backend``
module is imported.
"""

import os
import tempfile
import uuid
from pathlib import Path
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

_SANDBOX = Path(tempfile.mkdtemp(prefix="filenexus-test-"))
_DATA = _SANDBOX / "data"
STATIC_DIR = _SANDBOX / "static"
STATIC_DIR.mkdir(parents=True)
(STATIC_DIR / "index.html").write_text(
    "<html><title>SPA</title></html>", encoding="utf-8"
)
(STATIC_DIR / "app.js").write_text("console.log('ok');", encoding="utf-8")
SECRET_FILE = _SANDBOX / "secret.txt"
SECRET_FILE.write_text("TOP-SECRET", encoding="utf-8")

os.environ.update(
    {
        "PATHS__UPLOAD_FOLDER": str(_DATA / "uploads"),
        "PATHS__USER_INFO_FILE": str(_DATA / "user_info.json"),
        "PATHS__TUS_TEMP_FOLDER": str(_DATA / "tus_temp"),
        "PATHS__STATIC_DIR": str(STATIC_DIR),
        "PATHS__USERS_DB": str(_DATA / "users.db"),
        "PATHS__NOTES_DB": str(_DATA / "notes.db"),
        "PATHS__FILES_DB": str(_DATA / "files.db"),
        "RATE_LIMIT__ENABLED": "false",
        "PUSH__DEBOUNCE_SECONDS": "0.02",
        # Password-only device login bcrypt-verifies every stored account, so
        # the production cost (12) made each register() call O(users) * ~0.2s.
        # The minimum cost keeps real bcrypt hashing/verification in tests.
        "SECURITY__BCRYPT_ROUNDS": "4",
    }
)
# TusMetadataStore resolves "data/tus_metadata.db" against the CWD.
os.chdir(_SANDBOX)


@pytest.fixture(scope="session")
def client() -> Iterator[TestClient]:
    """Yield a TestClient with the application lifespan (DB init) running.

    The app is imported lazily so the environment above is applied first.

    Yields:
        A started ``TestClient`` bound to the FastAPI app.
    """
    from backend.app import app

    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture()
def account(client: TestClient) -> Iterator[dict[str, Any]]:
    """Seed an isolated locked account with a distinct physical storage name."""
    from backend.services.user_service import user_service

    username = f"native-{uuid.uuid4().hex}"
    password = f"password-{username}"
    user = client.portal.call(
        user_service.create_user, username, password, f"disk-{username}"
    )
    client.portal.call(user_service.update_user, username, {"is_locked": True})
    try:
        yield {**user, "password": password}
    finally:
        client.portal.call(user_service.delete_user, username)
