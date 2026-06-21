"""FastAPI dependencies — current user extraction, role enforcement, JWT blocklist."""

import uuid
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.redis import get_redis
from core.security import decode_access_token
from shared.database import get_session
from shared.models import User, UserRole

bearer = HTTPBearer()


async def get_current_user(
    credentials: Annotated[HTTPAuthorizationCredentials, Depends(bearer)],
    db: Annotated[AsyncSession, Depends(get_session)],
) -> User:
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired token",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = decode_access_token(credentials.credentials)
        user_id = uuid.UUID(payload["sub"])
        jti: str = payload["jti"]
    except (JWTError, KeyError, ValueError):
        raise credentials_exception

    # ── JWT blocklist check (Redis) ───────────────────────────────────────
    # Tokens are added here on explicit logout or password change.
    try:
        redis = get_redis()
        if await redis.exists(f"jwt:blocklist:{jti}"):
            raise credentials_exception
    except HTTPException:
        raise   # ← Must re-raise: broad Exception below would swallow it otherwise
    except Exception:
        # Redis unreachable — fail open (log and continue)
        import structlog
        structlog.get_logger().error("redis.blocklist_check_failed", jti=jti)

    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.is_active == True,
            User.is_deleted == False,
        )
    )
    user = result.scalar_one_or_none()
    if user is None:
        raise credentials_exception
    return user


def require_role(*roles: UserRole):
    """
    Role-based access control.
    SUPER_ADMIN is implicitly allowed wherever ADMIN is allowed —
    no need to explicitly list SUPER_ADMIN on every endpoint.
    """
    expanded = set(roles)
    if UserRole.ADMIN in expanded:
        expanded.add(UserRole.SUPER_ADMIN)

    async def _check(user: Annotated[User, Depends(get_current_user)]) -> User:
        if user.role not in expanded:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Insufficient permissions",
            )
        return user
    return _check


async def blocklist_jti(jti: str, expire_seconds: int) -> None:
    """Add a JWT jti to the Redis blocklist with TTL = remaining token lifetime."""
    try:
        redis = get_redis()
        await redis.setex(f"jwt:blocklist:{jti}", expire_seconds, "1")
    except Exception:
        import structlog
        structlog.get_logger().error("redis.blocklist_write_failed", jti=jti)
