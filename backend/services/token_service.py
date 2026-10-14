"""
Session, access and share tokens.

Tokens are cached in memory (keyed by their SHA-256 hash) for fast validation
and written through to the ``auth_tokens`` table in users.db, so logins and
share links survive a backend restart. Plaintext tokens are never stored.
"""

import hashlib
import logging
import sqlite3
from contextlib import closing
import secrets
from datetime import datetime, timedelta
from pathlib import Path
from typing import Dict, Iterable, Optional

from pydantic import BaseModel

from backend.config import settings

logger = logging.getLogger(__name__)

SHARE_TOKEN_TYPE = "share"
# Token types that authenticate the account owner (login sessions).
OWNER_TOKEN_TYPES = frozenset({"session", "access"})


class TokenInfo(BaseModel):
    """Metadata for a sharing or access token."""

    username: str
    filename: Optional[str] = None  # None for full access tokens
    expiry: datetime
    token_type: str = "share"  # 'share', 'access', or 'session'


def hash_token(token: str) -> str:
    """Return the SHA-256 hex digest used to index and persist a token.

    Args:
        token: Plaintext bearer token.

    Returns:
        Lowercase hex digest of the UTF-8 encoded token.
    """
    return hashlib.sha256(token.encode()).hexdigest()


class TokenService:
    """Service for generating and validating tokens."""

    def __init__(self, expiry_hours: int = 24, db_path: Optional[Path] = None) -> None:
        """Initialize the service.

        Args:
            expiry_hours: How long share tokens remain valid.
            db_path: SQLite file holding ``auth_tokens``; defaults to users.db.
        """
        self.expiry_hours = expiry_hours
        self._db_path = db_path
        # Keyed by hash_token(token), never by the plaintext token.
        self.tokens: Dict[str, TokenInfo] = {}

    def _connect(self) -> sqlite3.Connection:
        """Open a short-lived connection to the token database.

        Token writes only happen on login and share creation, so a blocking
        connection per write keeps the synchronous API without a worker pool.

        Returns:
            An open sqlite3 connection (caller closes it).
        """
        path = self._db_path or settings.paths.users_db
        return sqlite3.connect(str(path), timeout=15)

    def load(self) -> int:
        """Restore unexpired tokens from the database and purge expired rows.

        Must run after ``init_db`` created the ``auth_tokens`` table.

        Returns:
            Number of tokens restored into memory.
        """
        now = datetime.now()
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "DELETE FROM auth_tokens WHERE expires_at <= ?", (now.isoformat(),)
            )
            rows = conn.execute(
                "SELECT token_hash, username, filename, token_type, expires_at "
                "FROM auth_tokens"
            ).fetchall()
        for token_hash, username, filename, token_type, expires_at in rows:
            self.tokens[token_hash] = TokenInfo(
                username=username,
                filename=filename,
                expiry=datetime.fromisoformat(expires_at),
                token_type=token_type,
            )
        logger.info("Restored %d auth tokens from the database.", len(rows))
        return len(rows)

    def _issue(self, token: str, info: TokenInfo) -> str:
        """Cache and persist a newly generated token.

        Args:
            token: Plaintext token returned to the caller.
            info: Metadata describing the token.

        Returns:
            The plaintext token.
        """
        token_hash = hash_token(token)
        with closing(self._connect()) as conn, conn:
            conn.execute(
                "INSERT INTO auth_tokens "
                "(token_hash, username, filename, token_type, expires_at) "
                "VALUES (?, ?, ?, ?, ?)",
                (
                    token_hash,
                    info.username,
                    info.filename,
                    info.token_type,
                    info.expiry.isoformat(),
                ),
            )
        self.tokens[token_hash] = info
        self._cleanup()
        return token

    def _forget(self, token_hashes: Iterable[str]) -> None:
        """Drop tokens from memory and the database.

        Args:
            token_hashes: Hashes of the tokens to remove.
        """
        hashes = list(token_hashes)
        if not hashes:
            return
        with closing(self._connect()) as conn, conn:
            conn.executemany(
                "DELETE FROM auth_tokens WHERE token_hash = ?",
                [(token_hash,) for token_hash in hashes],
            )
        for token_hash in hashes:
            self.tokens.pop(token_hash, None)

    def create_token(self, username: str, filename: str) -> str:
        """Create a new sharing token for a specific file.

        Args:
            username: The owner of the file.
            filename: The file to share.

        Returns:
            A unique token string.
        """
        expiry = datetime.now() + timedelta(hours=self.expiry_hours)
        return self._issue(
            secrets.token_urlsafe(32),
            TokenInfo(
                username=username, filename=filename, expiry=expiry, token_type="share"
            ),
        )

    def create_access_token(self, username: str) -> str:
        """Create a general access token for a user session (legacy compatibility).

        Args:
            username: The user to authorize.

        Returns:
            A unique token string.
        """
        expiry = datetime.now() + timedelta(hours=72)
        return self._issue(
            secrets.token_urlsafe(32),
            TokenInfo(username=username, expiry=expiry, token_type="access"),
        )

    def create_session_token(self, username: str) -> str:
        """Create a persistent session token for a user.

        Args:
            username: The username authorized by the password.

        Returns:
            A unique session token string.
        """
        expiry = datetime.now() + timedelta(hours=72)  # 3 days of convenience
        return self._issue(
            secrets.token_urlsafe(64),
            TokenInfo(username=username, expiry=expiry, token_type="session"),
        )

    def validate_token(self, token: str) -> Optional[TokenInfo]:
        """Check if a token is valid and not expired.

        Args:
            token: The token to check.

        Returns:
            TokenInfo if valid, None otherwise.
        """
        if not token:
            return None
        return self.validate_hash(hash_token(token))

    def validate_hash(self, token_hash: str) -> Optional[TokenInfo]:
        """Validate a token by its SHA-256 hash (for stored upload origins).

        Args:
            token_hash: Output of ``hash_token`` for the original token.

        Returns:
            TokenInfo if the token is known and unexpired, None otherwise.
        """
        info = self.tokens.get(token_hash)
        if info is None:
            return None
        if datetime.now() > info.expiry:
            self._forget([token_hash])
            return None
        return info

    def owner_username(self, token: Optional[str]) -> Optional[str]:
        """Return the account a token authenticates as owner, if any.

        Only session and access tokens are owner credentials. Share tokens
        are capabilities for a single file and never identify an owner.

        Args:
            token: The token to check (may be None or empty).

        Returns:
            The owning username for a valid owner token, None otherwise.
        """
        info = self.validate_token(token) if token else None
        if info is None or info.token_type not in OWNER_TOKEN_TYPES:
            return None
        return info.username

    def is_owner_token(self, token: Optional[str], username: str) -> bool:
        """Check whether a token grants owner-wide access to ``username``.

        Args:
            token: The token to check (may be None or empty).
            username: The account being accessed.

        Returns:
            True for a valid session/access token issued to ``username``.
        """
        return self.owner_username(token) == username

    async def resolve_owner_username(self, token: Optional[str]) -> Optional[str]:
        """Resolve a session/access credential first, then a persisted device.

        Args:
            token: Credential presented by the caller.

        Returns:
            Owning username for an active owner credential, or None.
        """
        owner = self.owner_username(token)
        if owner is not None:
            return owner
        from backend.services.device_service import device_service

        device = await device_service.resolve_token(token)
        return device["username"] if device is not None else None

    async def resolves_owner(self, token: Optional[str], username: str) -> bool:
        """Check account ownership for session/access and device credentials.

        Args:
            token: Caller credential.
            username: Target account.

        Returns:
            Whether the credential identifies the target owner.
        """
        return await self.resolve_owner_username(token) == username

    async def resolves_file_access(
        self,
        token: Optional[str],
        username: str,
        filename: str,
    ) -> bool:
        """Authorize file reads for owners or an exact single-file capability.

        Args:
            token: Caller credential.
            username: Target owner.
            filename: Target file.

        Returns:
            Whether file access is authorized.
        """
        if await self.resolves_owner(token, username):
            return True
        share = self.get_share_token(token)
        return (
            share is not None
            and share.username == username
            and share.filename == filename
        )

    def get_share_token(self, token: Optional[str]) -> Optional[TokenInfo]:
        """Validate a token that must be a file share token.

        Args:
            token: The token to check (may be None or empty).

        Returns:
            The TokenInfo for a valid share token, None otherwise.
        """
        info = self.validate_token(token) if token else None
        if info is None or info.token_type != SHARE_TOKEN_TYPE or not info.filename:
            return None
        return info

    def grants_file_access(
        self, token: Optional[str], username: str, filename: str
    ) -> bool:
        """Check whether a token may read a specific file of ``username``.

        Owner tokens (session/access) grant access to every file of their
        user; a share token grants access only to the exact file it was
        issued for.

        Args:
            token: The token to check (may be None or empty).
            username: The owner of the requested file.
            filename: The requested file.

        Returns:
            True if the token authorizes reading the file.
        """
        if self.is_owner_token(token, username):
            return True
        share = self.get_share_token(token)
        return (
            share is not None
            and share.username == username
            and share.filename == filename
        )

    def _cleanup(self) -> None:
        """Remove expired tokens from memory and the database."""
        now = datetime.now()
        self._forget([h for h, info in self.tokens.items() if now > info.expiry])


# Singleton instance
token_service = TokenService()
