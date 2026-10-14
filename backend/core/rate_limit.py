"""Request rate limiting: the shared slowapi limiter and a password-scan budget."""

import time
from typing import Callable

from fastapi import HTTPException, status
from limits import parse
from limits.storage import MemoryStorage
from limits.strategies import MovingWindowRateLimiter
from slowapi import Limiter
from slowapi.util import get_remote_address

from backend.config import settings

# Initialize Global Limiter
limiter = Limiter(
    key_func=get_remote_address,
    enabled=settings.rate_limit.enabled,
    default_limits=[settings.rate_limit.default_limit]
)

# We can define constants for rates if we want
LOGIN_LIMIT = settings.rate_limit.login_limit
ADMIN_LIMIT = settings.rate_limit.admin_limit
UPLOAD_LIMIT = settings.rate_limit.upload_limit
TUS_LIMIT = settings.rate_limit.tus_limit
PASSWORD_SCAN_LIMIT = settings.rate_limit.password_scan_limit


class PasswordScanLimitExceeded(HTTPException):
    """Raised when a client exhausts its budget of uncached password scans.

    It is an ``HTTPException`` so that routes which re-raise HTTP errors from
    broad ``except`` blocks (e.g. TUS creation) still return a 429.
    """

    def __init__(self, retry_after_seconds: int) -> None:
        """Build a 429 response carrying a ``Retry-After`` header.

        Args:
            retry_after_seconds: Seconds until the client may try again.
        """
        super().__init__(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many password attempts; try again later",
            headers={"Retry-After": str(retry_after_seconds)},
        )


class PasswordScanBudget:
    """Per-client cap on password lookups that miss the lookup cache.

    Only uncached lookups (the expensive bcrypt scan over every user) consume
    budget; a password that already resolved successfully is served from the
    cache and is never refused, so legitimate repeat use is unaffected.
    """

    def __init__(self, limit: str, is_enabled: Callable[[], bool]) -> None:
        """Create a budget with its own in-memory counters.

        Args:
            limit: A ``limits`` rate string such as ``"10/minute"``.
            is_enabled: Returns whether rate limiting is currently active.
        """
        self._item = parse(limit)
        self._storage = MemoryStorage()
        self._strategy = MovingWindowRateLimiter(self._storage)
        self._is_enabled = is_enabled

    def consume(self, client_key: str) -> None:
        """Spend one scan from ``client_key``'s budget.

        Args:
            client_key: Client identity, the same key slowapi uses.

        Raises:
            PasswordScanLimitExceeded: If the budget for this window is spent.
        """
        if not self._is_enabled():
            return
        if self._strategy.hit(self._item, client_key):
            return
        window = self._strategy.get_window_stats(self._item, client_key)
        raise PasswordScanLimitExceeded(max(1, int(window.reset_time - time.time()) + 1))

    def reset(self) -> None:
        """Clear every client's counters."""
        self._storage.reset()


password_scan_budget = PasswordScanBudget(PASSWORD_SCAN_LIMIT, lambda: limiter.enabled)
