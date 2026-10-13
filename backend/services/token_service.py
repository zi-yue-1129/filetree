"""
Sharing service for temporary download tokens.
"""

import secrets
from datetime import datetime, timedelta
from typing import Dict, Optional

from pydantic import BaseModel

SHARE_TOKEN_TYPE = "share"
# Token types that authenticate the account owner (login sessions).
OWNER_TOKEN_TYPES = frozenset({"session", "access"})


class TokenInfo(BaseModel):
    """Metadata for a sharing or access token."""

    username: str
    filename: Optional[str] = None  # None for full access tokens
    expiry: datetime
    token_type: str = "share"  # 'share', 'access', or 'session'


class TokenService:
    """Service for generating and validating tokens."""

    def __init__(self, expiry_hours: int = 24) -> None:
        """Initialize the service.

        Args:
            expiry_hours: How long tokens remain valid.
        """
        self.expiry_hours = expiry_hours
        self.tokens: Dict[str, TokenInfo] = {}

    def create_token(self, username: str, filename: str) -> str:
        """Create a new sharing token for a specific file.

        Args:
            username: The owner of the file.
            filename: The file to share.

        Returns:
            A unique token string.
        """
        token = secrets.token_urlsafe(32)
        expiry = datetime.now() + timedelta(hours=self.expiry_hours)
        self.tokens[token] = TokenInfo(
            username=username, filename=filename, expiry=expiry, token_type="share"
        )
        self._cleanup()
        return token

    def create_access_token(self, username: str) -> str:
        """Create a general access token for a user session (legacy compatibility).

        Args:
            username: The user to authorize.

        Returns:
            A unique token string.
        """
        token = secrets.token_urlsafe(32)
        # Use longer expiry for sessions to improve convenience
        expiry = datetime.now() + timedelta(hours=72)
        self.tokens[token] = TokenInfo(
            username=username, expiry=expiry, token_type="access"
        )
        self._cleanup()
        return token

    def create_session_token(self, username: str) -> str:
        """Create a persistent session token for a user.

        Args:
            username: The username authorized by the password.

        Returns:
            A unique session token string.
        """
        token = secrets.token_urlsafe(64)
        expiry = datetime.now() + timedelta(hours=72)  # 3 days of convenience
        self.tokens[token] = TokenInfo(
            username=username, expiry=expiry, token_type="session"
        )
        self._cleanup()
        return token

    def validate_token(self, token: str) -> Optional[TokenInfo]:
        """Check if a token is valid and not expired.

        Args:
            token: The token to check.

        Returns:
            TokenInfo if valid, None otherwise.
        """
        if not token:
            return None

        info = self.tokens.get(token)
        if not info:
            return None

        if datetime.now() > info.expiry:
            del self.tokens[token]
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
        """Remove expired tokens from memory."""
        now = datetime.now()
        # Create a list of keys to delete to avoid dictionary size change during iteration
        expired = [t for t, info in self.tokens.items() if now > info.expiry]
        for t in expired:
            del self.tokens[t]


# Singleton instance
token_service = TokenService()
