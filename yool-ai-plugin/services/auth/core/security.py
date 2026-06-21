"""JWT RS256 signing/verification and bcrypt password hashing."""

import secrets
import uuid
from datetime import datetime, timedelta, timezone

import bcrypt
from jose import JWTError, jwt

from core.config import settings
from core.utils import hash_token


# ── Password hashing ────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt(rounds=12)).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


# ── JWT RS256 ────────────────────────────────────────────────────────────────

def create_access_token(user_id: uuid.UUID, role: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(
        minutes=settings.JWT_ACCESS_EXPIRE_MINUTES
    )
    payload = {
        "sub": str(user_id),
        "role": role,
        "exp": expire,
        "iat": datetime.now(timezone.utc),
        "jti": str(uuid.uuid4()),  # unique token ID
    }
    return jwt.encode(payload, settings.jwt_private_key, algorithm=settings.JWT_ALGORITHM)


def create_refresh_token() -> tuple[str, str]:
    """Return (raw_token, sha256_hash). Store only the hash."""
    raw = secrets.token_urlsafe(64)
    return raw, hash_token(raw)


def decode_access_token(token: str) -> dict:
    """Raises JWTError if invalid or expired."""
    return jwt.decode(
        token,
        settings.jwt_public_key,
        algorithms=[settings.JWT_ALGORITHM],
    )


def hash_refresh_token(raw: str) -> str:
    """SHA-256 hash of a raw refresh token. Delegates to hash_token."""
    return hash_token(raw)
