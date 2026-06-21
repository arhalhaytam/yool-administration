"""Session service JWT dependencies — RS256 verification + Redis blocklist check."""

import uuid
from typing import Annotated

import structlog
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jose import JWTError, jwt
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.redis import get_redis
from shared.database import get_session
from shared.models import User, UserRole

log = structlog.get_logger()
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
        payload = jwt.decode(
            credentials.credentials,
            settings.jwt_public_key,
            algorithms=[settings.JWT_ALGORITHM],
        )
        user_id = uuid.UUID(payload["sub"])
        jti: str | None = payload.get("jti")
    except (JWTError, KeyError, ValueError):
        raise credentials_exception

    # ── JWT blocklist check (shared Redis with auth service) ──────────────────
    if jti:
        try:
            if await get_redis().exists(f"jwt:blocklist:{jti}"):
                raise credentials_exception
        except HTTPException:
            raise  # must re-raise before the broad except swallows it
        except Exception:
            log.error("redis.blocklist_check_failed", service="session", jti=jti)

    result = await db.execute(
        select(User).where(
            User.id == user_id,
            User.is_active == True,
            User.is_deleted == False,
        )
    )
    user = result.scalar_one_or_none()
    if not user:
        raise credentials_exception
    return user


def require_role(*roles: UserRole):
    """Role-based access control.

    SUPER_ADMIN is implicitly allowed wherever ADMIN is allowed —
    no need to list SUPER_ADMIN on every endpoint.
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
