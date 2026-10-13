"""Password-only lookup: cost per login, event-loop health, and semantics.

Bcrypt work is observed through a counting wrapper around the real
``bcrypt.checkpw`` (the real function still runs), so the tests measure the
actual number of bcrypt verifications regardless of how they are dispatched.
"""

import asyncio
import threading
import time
import uuid
from typing import Any, Callable, Iterator

import bcrypt
import pytest
from fastapi.testclient import TestClient

from backend.core.auth import generate_salt, hash_password
from backend.services.database import get_users_db
from backend.services.user_service import user_service


class CheckpwCounter:
    """Thread-safe counter of real ``bcrypt.checkpw`` invocations."""

    def __init__(self, real_checkpw: Callable[[bytes, bytes], bool]) -> None:
        """Wrap the real verifier.

        Args:
            real_checkpw: The original ``bcrypt.checkpw`` function.
        """
        self._real_checkpw = real_checkpw
        self._lock = threading.Lock()
        self.calls = 0

    def __call__(self, password: bytes, hashed_password: bytes) -> bool:
        """Count the call and delegate to the real bcrypt verifier.

        Args:
            password: Candidate password bytes.
            hashed_password: Stored bcrypt hash bytes.

        Returns:
            The real verification result.
        """
        with self._lock:
            self.calls += 1
        return self._real_checkpw(password, hashed_password)

    def reset(self) -> None:
        """Reset the call counter to zero."""
        with self._lock:
            self.calls = 0


@pytest.fixture()
def checkpw_counter(monkeypatch: pytest.MonkeyPatch) -> CheckpwCounter:
    """Install a counting (not replacing) wrapper around ``bcrypt.checkpw``."""
    counter = CheckpwCounter(bcrypt.checkpw)
    # Not a mock: the wrapper delegates every call to the real bcrypt.checkpw
    # and only counts invocations, which is the quantity under test.
    monkeypatch.setattr(bcrypt, "checkpw", counter)
    return counter


@pytest.fixture()
def make_user(client: TestClient) -> Iterator[Callable[[str], dict[str, Any]]]:
    """Create throwaway users with a given password and delete them afterwards."""
    created: list[str] = []

    def factory(password: str) -> dict[str, Any]:
        """Create one user whose username is unique to this test run."""
        username = f"pwlookup-{uuid.uuid4().hex}"
        user = client.portal.call(user_service.create_user, username, password)
        created.append(username)
        return user

    yield factory
    for username in created:
        client.portal.call(user_service.delete_user, username)


def lookup(client: TestClient, password: str) -> dict[str, Any] | None:
    """Run the password-only lookup on the application's event loop."""
    return client.portal.call(user_service.get_user_by_password, password)


async def _set_hash_out_of_band(user_id: int, new_password: str) -> None:
    """Rewrite a user's hash directly in SQL, like the CLI or another worker."""
    salt = generate_salt()
    database = await get_users_db()
    await database.execute(
        "UPDATE users SET salt = ?, hashed_password = ? WHERE id = ?",
        (salt, hash_password(new_password, salt), user_id),
    )
    await database.commit()


def test_repeat_login_needs_no_bcrypt_scan(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
    checkpw_counter: CheckpwCounter,
) -> None:
    """A second login with the same password must not rescan every user."""
    for index in range(3):
        make_user(f"other-{index}-{uuid.uuid4().hex}")
    password = f"target-{uuid.uuid4().hex}"
    target = make_user(password)

    first = lookup(client, password)
    assert first is not None and first["id"] == target["id"]
    assert checkpw_counter.calls >= 1

    checkpw_counter.reset()
    second = lookup(client, password)
    assert second is not None and second["id"] == target["id"]
    assert checkpw_counter.calls == 0


def test_wrong_password_scan_keeps_event_loop_responsive(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
    checkpw_counter: CheckpwCounter,
) -> None:
    """Bcrypt must run off the event loop so other requests keep flowing."""
    for index in range(3):
        make_user(f"loop-{index}-{uuid.uuid4().hex}")

    async def scan_while_ticking() -> tuple[dict[str, Any] | None, float]:
        """Run a failing scan while a ticker measures event-loop stalls."""
        stalls: list[float] = []
        scanning = True

        async def ticker() -> None:
            """Record the gap between consecutive 5 ms sleeps."""
            last = time.perf_counter()
            while scanning:
                await asyncio.sleep(0.005)
                now = time.perf_counter()
                stalls.append(now - last)
                last = now

        ticker_task = asyncio.create_task(ticker())
        await asyncio.sleep(0.02)
        result = await user_service.get_user_by_password(f"wrong-{uuid.uuid4().hex}")
        scanning = False
        await ticker_task
        return result, max(stalls)

    result, worst_stall = client.portal.call(scan_while_ticking)
    assert result is None
    # The scan covers >= 3 cost-12 hashes; a single blocking verify stalls ~0.2 s.
    assert checkpw_counter.calls >= 3
    assert worst_stall < 0.1, f"event loop stalled for {worst_stall:.3f}s"


def test_duplicate_passwords_pick_lowest_id_fresh_and_cached(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
) -> None:
    """Duplicate passwords resolve to the earliest user, cached or not."""
    shared = f"shared-{uuid.uuid4().hex}"
    earlier = make_user(shared)
    later = make_user(shared)
    assert earlier["id"] < later["id"]

    assert lookup(client, shared)["id"] == earlier["id"]
    assert lookup(client, shared)["id"] == earlier["id"]

    # Resetting the earlier user hands the password to the later user.
    client.portal.call(
        user_service.reset_password, earlier["username"], f"moved-{uuid.uuid4().hex}"
    )
    assert lookup(client, shared)["id"] == later["id"]
    assert lookup(client, shared)["id"] == later["id"]

    # Giving the earlier user the shared password again must win over the
    # cached later user.
    client.portal.call(user_service.reset_password, earlier["username"], shared)
    assert lookup(client, shared)["id"] == earlier["id"]


def test_out_of_band_hash_change_is_detected(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
) -> None:
    """A hash rewritten outside the service (CLI, other worker) is honoured."""
    password = f"oob-{uuid.uuid4().hex}"
    user = make_user(password)
    assert lookup(client, password)["id"] == user["id"]

    client.portal.call(_set_hash_out_of_band, user["id"], f"new-{uuid.uuid4().hex}")
    assert lookup(client, password) is None


def test_password_reset_and_delete_invalidate(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
) -> None:
    """Old passwords stop working after reset; deleted users never resolve."""
    old_password = f"old-{uuid.uuid4().hex}"
    new_password = f"new-{uuid.uuid4().hex}"
    user = make_user(old_password)
    assert lookup(client, old_password)["id"] == user["id"]

    client.portal.call(user_service.reset_password, user["username"], new_password)
    assert lookup(client, old_password) is None
    assert lookup(client, new_password)["id"] == user["id"]

    client.portal.call(user_service.delete_user, user["username"])
    assert lookup(client, new_password) is None


def test_cached_lookup_returns_fresh_user_state(
    client: TestClient,
    make_user: Callable[[str], dict[str, Any]],
) -> None:
    """Lock and first-login flags come from the database, not the cache."""
    password = f"state-{uuid.uuid4().hex}"
    user = make_user(password)
    first = lookup(client, password)
    assert first["is_locked"] is False and first["first_login"] is True

    client.portal.call(
        user_service.update_user,
        user["username"],
        {"is_locked": True, "first_login": False},
    )
    second = lookup(client, password)
    assert second["is_locked"] is True and second["first_login"] is False
