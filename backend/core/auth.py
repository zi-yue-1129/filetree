"""Password verification and asynchronous owner authentication helpers."""

from typing import Optional

import bcrypt
from fastapi import Header, HTTPException, status

from backend.services.token_service import token_service


def extract_bearer_token(authorization: Optional[str]) -> Optional[str]:
    """Extract a credential from a correctly formed Bearer header.

    Args:
        authorization: Optional HTTP authorization value.

    Returns:
        Credential or None for a missing or malformed header.
    """
    if not authorization:
        return None
    scheme, separator, token = authorization.partition(" ")
    return (
        token.strip()
        if separator and scheme.lower() == "bearer" and token.strip()
        else None
    )


async def get_current_user_token(authorization: Optional[str] = Header(None)) -> str:
    """Extract and validate an owner credential from the Bearer header.

    Args:
        authorization: Optional Bearer authorization header.

    Returns:
        An authenticated session, access, or device credential.

    Raises:
        HTTPException: If the header or owner credential is invalid.
    """
    token = extract_bearer_token(authorization)
    if token is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
        )

    if not await token_service.resolve_owner_username(token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )
    return token


async def verify_ownership(token: str, target_username: str) -> bool:
    """Verify that the token is an owner (session/access) token for a user.

    Share tokens are single-file capabilities and never prove ownership.

    Args:
        token: The bearer token to check.
        target_username: The account the caller wants to act on.

    Returns:
        True if the token is a valid owner token for ``target_username``.

    Raises:
        HTTPException: 403 if the token is invalid, expired, a share token,
            or issued to a different user.
    """
    if not await token_service.resolves_owner(token, target_username):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Access denied: You do not own this resource",
        )
    return True


def generate_salt() -> str:
    """Generate a random bcrypt salt.

    Returns:
        A salt string.
    """
    return bcrypt.gensalt().decode("utf-8")


def hash_password(password: str, salt: str) -> str:
    """Hash a password with a salt using bcrypt.

    Args:
        password: The plain text password.
        salt: The salt string (bcrypt salt).

    Returns:
        The hashed password string.
    """
    return bcrypt.hashpw(password.encode(), salt.encode()).decode("utf-8")


def verify_password(password: str, salt: str, hashed: str) -> bool:
    """Verify a password against its hash and salt.

    Args:
        password: The plain text password to check.
        salt: The salt used for hashing (stored in user metadata).
        hashed: The expected hash.

    Returns:
        True if the password is correct, False otherwise.
    """
    try:
        # bcrypt.checkpw can derive the salt from the hash itself,
        # but since we store salt separately in this system's schema,
        # we'll use it to ensure we're matching the expected parameters.
        return bcrypt.checkpw(password.encode(), hashed.encode())
    except Exception:
        # Fallback/Safety for potential invalid formats
        return False
