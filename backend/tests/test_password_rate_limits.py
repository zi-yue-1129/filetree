"""Per-client limits on password-checking endpoints.

The suite disables rate limiting globally (``RATE_LIMIT__ENABLED=false``);
these tests switch the shared limiter on for their duration only and clear
its counters afterwards so no other test is affected.
"""

import uuid
from typing import Any, Iterator

import pytest
from fastapi.testclient import TestClient

from backend.core.rate_limit import limiter, password_scan_budget


@pytest.fixture()
def limits_enabled(monkeypatch: pytest.MonkeyPatch) -> Iterator[None]:
    """Enable the shared limiter and reset all counters (incl. scan budget)."""
    limiter.reset()
    password_scan_budget.reset()
    monkeypatch.setattr(limiter, "enabled", True)
    yield
    limiter.reset()
    password_scan_budget.reset()


@pytest.mark.parametrize(
    ("path_template", "fields"),
    [
        ("/api/user/{username}/unlock", {"password": "wrong"}),
        (
            "/api/user/change-password",
            {"username": "{username}", "old_password": "wrong", "new_password": "x"},
        ),
    ],
)
def test_single_user_password_endpoints_are_rate_limited(
    client: TestClient,
    account: dict[str, Any],
    limits_enabled: None,
    path_template: str,
    fields: dict[str, str],
) -> None:
    """Unlock and change-password share the login limit (5/minute)."""
    path = path_template.format(username=account["username"])
    form = {key: value.format(username=account["username"]) for key, value in fields.items()}
    statuses = [client.post(path, data=form).status_code for _ in range(6)]
    assert statuses[:5] == [401] * 5
    assert statuses[5] == 429


def test_failed_password_scans_are_budgeted_per_client(
    client: TestClient,
    account: dict[str, Any],
    limits_enabled: None,
) -> None:
    """Uncached password scans are capped per client; cached logins still work.

    ``/api/upload_url`` accepts a password and has no route limit of its own,
    so it exercises the scan budget (10 uncached scans per minute) directly.
    """
    # Warm the cache with the real password before exhausting the budget.
    warm = client.post(
        "/api/upload_url", data={"password": account["password"], "url": "https://a.example"}
    )
    assert warm.status_code == 200, warm.text

    statuses = [
        client.post(
            "/api/upload_url",
            data={"password": f"wrong-{uuid.uuid4().hex}", "url": "https://b.example"},
        ).status_code
        for _ in range(10)
    ]
    assert statuses[:9] == [401] * 9
    assert statuses[9] == 429

    cached = client.post(
        "/api/upload_url", data={"password": account["password"], "url": "https://c.example"}
    )
    assert cached.status_code == 200, cached.text
