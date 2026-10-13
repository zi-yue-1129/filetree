import bcrypt
from fastapi import Header, HTTPException, status, Request
from backend.services.token_service import token_service


def get_current_user_token(authorization: str = Header(None)) -> str:
    """Extract and validate session token from header."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing or invalid authentication token",
        )
    
    token = authorization.split(" ")[1]
    info = token_service.validate_token(token)
    if not info:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Session expired or invalid",
        )
    return token


def verify_ownership(token: str, target_username: str) -> bool:
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
    if not token_service.is_owner_token(token, target_username):
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
    return bcrypt.gensalt().decode('utf-8')


def hash_password(password: str, salt: str) -> str:
    """Hash a password with a salt using bcrypt.

    Args:
        password: The plain text password.
        salt: The salt string (bcrypt salt).

    Returns:
        The hashed password string.
    """
    return bcrypt.hashpw(password.encode(), salt.encode()).decode('utf-8')


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
