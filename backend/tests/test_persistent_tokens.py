"""Login sessions and share links must survive a backend restart.

A restart is simulated by building a fresh ``TokenService`` that only knows
what was persisted to ``users.db``.
"""

import sqlite3
from datetime import datetime, timedelta

from fastapi.testclient import TestClient

from backend.config import settings
from backend.services.token_service import TokenService, hash_token


def _restarted_service() -> TokenService:
    """Return a new service instance loaded from the database only."""
    restarted = TokenService()
    restarted.load()
    return restarted


def test_session_and_share_tokens_survive_restart(client: TestClient) -> None:
    """Tokens issued before a restart still validate afterwards."""
    original = TokenService()
    session = original.create_session_token("persist-user")
    share = original.create_token("persist-user", "report.pdf")

    restarted = _restarted_service()

    assert restarted.owner_username(session) == "persist-user"
    share_info = restarted.get_share_token(share)
    assert (share_info.username, share_info.filename, share_info.token_type) == (
        "persist-user",
        "report.pdf",
        "share",
    )
    assert restarted.owner_username(share) is None


def test_database_stores_only_token_hashes(client: TestClient) -> None:
    """A leaked users.db must not contain usable bearer tokens."""
    session = TokenService().create_session_token("hash-user")

    with sqlite3.connect(settings.paths.users_db) as database:
        rows = database.execute(
            "SELECT token_hash FROM auth_tokens WHERE username = ?", ("hash-user",)
        ).fetchall()

    assert rows == [(hash_token(session),)]


def test_expired_tokens_are_not_restored(client: TestClient) -> None:
    """Expired rows are dropped at load time instead of being revived."""
    original = TokenService()
    session = original.create_session_token("expired-user")
    with sqlite3.connect(settings.paths.users_db) as database:
        database.execute(
            "UPDATE auth_tokens SET expires_at = ? WHERE token_hash = ?",
            ((datetime.now() - timedelta(hours=1)).isoformat(), hash_token(session)),
        )

    restarted = _restarted_service()

    assert restarted.owner_username(session) is None
    with sqlite3.connect(settings.paths.users_db) as database:
        remaining = database.execute(
            "SELECT COUNT(*) FROM auth_tokens WHERE token_hash = ?",
            (hash_token(session),),
        ).fetchone()[0]
    assert remaining == 0


def test_login_token_survives_restart(client: TestClient, account: dict) -> None:
    """A token returned by /api/login authenticates after a restart."""
    response = client.post("/api/login", data={"password": account["password"]})
    assert response.status_code == 200, response.text

    restarted = _restarted_service()

    assert restarted.owner_username(response.json()["token"]) == account["username"]
