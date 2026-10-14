"""Off-loop bcrypt execution and a process-local cache for password-only login.

FileNexus identifies a user by password alone, so an uncached lookup must
bcrypt-verify the candidate against every stored hash. This module keeps that
work off the asyncio event loop and avoids repeating it:

* All bcrypt calls run on one bounded thread pool (bcrypt releases the GIL, so
  verifications of different users proceed in parallel without starving the
  event loop or the rest of the machine).
* Full scans run on a second, smaller pool, which caps how many scans can be
  in flight at once; excess scans queue instead of multiplying CPU load.
* Successful lookups are memoised in memory only, keyed by
  HMAC-SHA256(per-process random key, password). Each entry stores the matched
  user id plus a digest of every ``(id, bcrypt hash)`` row with
  ``id <= matched id``. A hit is trusted only while that digest still matches
  the database, i.e. while the exact inputs that produced the original
  "first matching user" answer are unchanged.

Nothing derived from a password is ever written to disk or the database.
"""

import asyncio
import hashlib
import hmac
import os
import secrets
import time
from collections import OrderedDict
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable, Optional, Sequence

from backend.core import auth as core_auth

#: Threads that run bcrypt. Kept small so a burst of logins cannot occupy
#: every core while downloads and WebSockets are being served.
BCRYPT_WORKERS = max(1, min(4, os.cpu_count() or 1))
#: Full password scans that may run at the same time; others wait in line.
MAX_CONCURRENT_SCANS = 2
#: Upper bound on cached successful lookups (one per distinct live password).
CACHE_MAX_ENTRIES = 1024
#: Lifetime of a cache entry, limiting how long a fingerprint stays in memory.
CACHE_TTL_SECONDS = 12 * 60 * 60

_bcrypt_pool = ThreadPoolExecutor(
    max_workers=BCRYPT_WORKERS, thread_name_prefix="bcrypt"
)
_scan_pool = ThreadPoolExecutor(
    max_workers=MAX_CONCURRENT_SCANS, thread_name_prefix="password-scan"
)


@dataclass(frozen=True)
class StoredCredential:
    """The password-related columns of one ``users`` row.

    Attributes:
        user_id: Primary key of the user.
        salt: Stored salt column (bcrypt embeds it in the hash as well).
        hashed_password: Stored bcrypt hash.
    """

    user_id: int
    salt: str
    hashed_password: str


async def verify_password_async(password: str, salt: str, hashed: str) -> bool:
    """Verify one password on the bcrypt pool without blocking the event loop.

    Args:
        password: Plain text candidate.
        salt: Stored salt for the user.
        hashed: Stored bcrypt hash for the user.

    Returns:
        True if the password matches the hash.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _bcrypt_pool, core_auth.verify_password, password, salt, hashed
    )


async def hash_password_async(password: str, salt: str) -> str:
    """Hash a password on the bcrypt pool without blocking the event loop.

    Args:
        password: Plain text password.
        salt: Bcrypt salt string.

    Returns:
        The bcrypt hash string.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _bcrypt_pool, core_auth.hash_password, password, salt
    )


def _first_match_blocking(
    password: str, credentials: Sequence[StoredCredential]
) -> Optional[int]:
    """Find the first credential matching ``password``, verifying in parallel.

    Every verification is submitted to the bcrypt pool up front, then results
    are consumed strictly in order, so the answer is identical to a sequential
    scan: the lowest index whose hash matches. Queued verifications that are
    no longer needed are cancelled once the answer is known.

    Args:
        password: Plain text candidate.
        credentials: Stored credentials in scan (``id``) order.

    Returns:
        Index of the first matching credential, or None if none match.
    """
    futures: list[Future[bool]] = [
        _bcrypt_pool.submit(
            core_auth.verify_password,
            password,
            credential.salt,
            credential.hashed_password,
        )
        for credential in credentials
    ]
    try:
        for index, future in enumerate(futures):
            if future.result():
                return index
        return None
    finally:
        for future in futures:
            future.cancel()


async def find_first_matching_credential(
    password: str, credentials: Sequence[StoredCredential]
) -> Optional[int]:
    """Run a full password scan on the bounded scan pool.

    Args:
        password: Plain text candidate.
        credentials: Stored credentials in scan (``id``) order.

    Returns:
        Index of the first matching credential, or None if none match.
    """
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        _scan_pool, _first_match_blocking, password, tuple(credentials)
    )


def credentials_digest(credentials: Sequence[StoredCredential]) -> bytes:
    """Digest the identity and hash of every credential, in order.

    The input contains only bcrypt hashes (already public to anyone holding the
    database), never passwords, so a fast hash is appropriate here.

    Args:
        credentials: Stored credentials in ``id`` order.

    Returns:
        A SHA-256 digest that changes if any row is added, removed, or rehashed.
    """
    digest = hashlib.sha256()
    for credential in credentials:
        digest.update(f"{credential.user_id}\x00{credential.hashed_password}\x00".encode())
    return digest.digest()


@dataclass(frozen=True)
class CachedMatch:
    """A remembered result of a successful full scan.

    Attributes:
        user_id: The first user whose hash matched.
        prefix_digest: ``credentials_digest`` of all rows with ``id <= user_id``
            at the time of the scan.
        expires_at: Monotonic deadline after which the entry is ignored.
    """

    user_id: int
    prefix_digest: bytes
    expires_at: float


class PasswordLookupCache:
    """Bounded, expiring, in-memory map from keyed password fingerprints to users.

    Keys are HMAC-SHA256 under a random key generated per process and never
    persisted, so entries are useless outside this process and vanish on
    restart. Intended for use from the event-loop thread only (no awaits occur
    inside its methods, so no locking is needed).
    """

    def __init__(
        self,
        max_entries: int = CACHE_MAX_ENTRIES,
        ttl_seconds: float = CACHE_TTL_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        """Create an empty cache.

        Args:
            max_entries: Maximum entries kept; least recently used are evicted.
            ttl_seconds: Seconds an entry stays valid after it is stored.
            clock: Monotonic time source.

        Raises:
            ValueError: If ``max_entries`` or ``ttl_seconds`` is not positive.
        """
        if max_entries <= 0 or ttl_seconds <= 0:
            raise ValueError("max_entries and ttl_seconds must be positive")
        self._hmac_key = secrets.token_bytes(32)
        self._max_entries = max_entries
        self._ttl_seconds = ttl_seconds
        self._clock = clock
        self._entries: OrderedDict[bytes, CachedMatch] = OrderedDict()

    def _fingerprint(self, password: str) -> bytes:
        """Compute the keyed fingerprint used as the cache key.

        Args:
            password: Plain text password.

        Returns:
            HMAC-SHA256 of the password under the per-process key.
        """
        return hmac.new(
            self._hmac_key, password.encode("utf-8", "surrogatepass"), hashlib.sha256
        ).digest()

    def get(self, password: str) -> Optional[CachedMatch]:
        """Look up a previous successful match for ``password``.

        Args:
            password: Plain text password.

        Returns:
            The cached match, or None if absent or expired.
        """
        key = self._fingerprint(password)
        entry = self._entries.get(key)
        if entry is None:
            return None
        if entry.expires_at <= self._clock():
            del self._entries[key]
            return None
        self._entries.move_to_end(key)
        return entry

    def put(self, password: str, user_id: int, prefix_digest: bytes) -> None:
        """Remember that ``password`` resolved to ``user_id``.

        Args:
            password: Plain text password that was verified with bcrypt.
            user_id: The first matching user.
            prefix_digest: Digest of all credentials with ``id <= user_id``.
        """
        key = self._fingerprint(password)
        self._entries[key] = CachedMatch(
            user_id=user_id,
            prefix_digest=prefix_digest,
            expires_at=self._clock() + self._ttl_seconds,
        )
        self._entries.move_to_end(key)
        while len(self._entries) > self._max_entries:
            self._entries.popitem(last=False)

    def discard(self, password: str) -> None:
        """Forget any entry for ``password``.

        Args:
            password: Plain text password.
        """
        self._entries.pop(self._fingerprint(password), None)

    def clear(self) -> None:
        """Forget every entry (used on password reset and user deletion)."""
        self._entries.clear()

    def __len__(self) -> int:
        """Return the number of stored entries, including not-yet-pruned expired ones."""
        return len(self._entries)


password_lookup_cache = PasswordLookupCache()
