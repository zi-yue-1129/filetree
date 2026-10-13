"""Configurable bcrypt work factor for password hashing."""

import pytest
from pydantic import ValidationError

from backend.config import SecurityConfig, settings
from backend.core.auth import generate_salt, hash_password, verify_password


def test_bcrypt_rounds_default_matches_bcrypt_default() -> None:
    """Production keeps bcrypt's own default cost of 12 unless configured."""
    assert SecurityConfig().bcrypt_rounds == 12


def test_bcrypt_rounds_rejects_out_of_range_cost() -> None:
    """Costs outside bcrypt's supported 4..31 range fail at configuration time."""
    with pytest.raises(ValidationError, match="bcrypt_rounds"):
        SecurityConfig(bcrypt_rounds=3)
    with pytest.raises(ValidationError, match="bcrypt_rounds"):
        SecurityConfig(bcrypt_rounds=32)


def test_generate_salt_uses_configured_rounds(monkeypatch: pytest.MonkeyPatch) -> None:
    """Salts encode the configured cost and still round-trip real verification."""
    monkeypatch.setattr(settings.security, "bcrypt_rounds", 5)
    salt = generate_salt()
    assert salt.startswith("$2b$05$")
    hashed = hash_password("correct horse", salt)
    assert hashed.startswith("$2b$05$")
    assert verify_password("correct horse", salt, hashed)
    assert not verify_password("wrong horse", salt, hashed)
