"""Redis-backed sliding-window rate limiter for the session service.

All session-service endpoints are authenticated, so rate limits here protect
against abuse from legitimate (or compromised) accounts rather than anonymous
attackers.

Algorithm: same sliding-window sorted-set approach as the auth service.

IMPORTANT — rate limits are called *inside* the endpoint function body
(not via Depends()) so they only fire after RBAC checks and request-body
validation succeed.  This prevents the budget from being consumed by 403/422
responses that would otherwise waste quota.
"""

import os
import time

from fastapi import HTTPException, Request, status

from core.config import settings
from core.redis import get_redis


async def _sliding_window(
    key: str,
    max_requests: int,
    window_seconds: int,
    message: str,
) -> None:
    redis = get_redis()
    now = time.time()
    window_start = now - window_seconds
    member = f"{now:.6f}-{os.urandom(4).hex()}"

    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, "-inf", window_start)
    pipe.zadd(key, {member: now})
    pipe.zcard(key)
    pipe.expire(key, window_seconds + 1)
    results = await pipe.execute()

    if results[2] > max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=message,
        )


async def check_course_create_rate_limit(request: Request) -> None:
    """Rate-limit course creation (POST /courses/).

    Default: COURSE_CREATE_RATE_LIMIT per IP per hour.
    Called inside the endpoint body after RBAC so 403/422 do not consume quota.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:course_create:{ip}",
        max_requests=settings.COURSE_CREATE_RATE_LIMIT,
        window_seconds=3600,
        message="Too many courses created. Try again in 1 hour.",
    )


async def check_session_create_rate_limit(request: Request) -> None:
    """Rate-limit session creation.

    Default: SESSION_CREATE_RATE_LIMIT per IP per hour.
    Override via the SESSION_CREATE_RATE_LIMIT env-var.

    Called *inside* the endpoint body so rejected requests (403/422) do not
    consume quota.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:session_create:{ip}",
        max_requests=settings.SESSION_CREATE_RATE_LIMIT,
        window_seconds=3600,
        message="Too many sessions created. Try again in 1 hour.",
    )


async def check_purge_rate_limit(request: Request) -> None:
    """Rate-limit the data-retention purge.

    Default: PURGE_RATE_LIMIT per IP per hour.
    Override via the PURGE_RATE_LIMIT env-var.

    Called *inside* the endpoint body so rejected requests (403/422) do not
    consume quota.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:purge:{ip}",
        max_requests=settings.PURGE_RATE_LIMIT,
        window_seconds=3600,
        message="Too many purge requests. Try again in 1 hour.",
    )
