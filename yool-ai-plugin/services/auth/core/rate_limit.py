"""Redis-backed rate limiter for auth endpoints — sliding window algorithm.

Why sliding window over fixed window?
--------------------------------------
Fixed window has a double-spend edge case:
    T=11:59:55 → 5 requests (window not yet reset)
    T=12:00:01 → 5 more    (new window just opened)
    = 10 requests in 6 seconds against a "5/minute" limit.

Sliding window uses a Redis sorted set and tracks each request's exact
timestamp. The window slides forward with real time — no artificial boundary.

Algorithm (atomic pipeline):
    1. ZREMRANGEBYSCORE: prune entries older than window_start
    2. ZADD:            record current request with timestamp as score
    3. ZCARD:           count requests in current window
    4. EXPIRE:          garbage-collect the key eventually

All four ops run in a single pipeline (atomic round-trip to Redis).
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
    """
    Sliding window rate limiter using a Redis sorted set.

    Each request is a member of the sorted set with `now` as its score.
    Old members (score < window_start) are pruned before counting.
    A unique suffix prevents score collisions on concurrent requests.
    """
    redis = get_redis()
    now = time.time()
    window_start = now - window_seconds
    # Unique member per request — prevents ZADD NX from deduping concurrent reqs
    member = f"{now:.6f}-{os.urandom(4).hex()}"

    pipe = redis.pipeline()
    pipe.zremrangebyscore(key, "-inf", window_start)   # 1. prune stale
    pipe.zadd(key, {member: now})                       # 2. record request
    pipe.zcard(key)                                     # 3. count in window
    pipe.expire(key, window_seconds + 1)               # 4. auto-GC TTL
    results = await pipe.execute()

    count = results[2]  # zcard result is index 2
    if count > max_requests:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail=message,
        )


# ── Public rate-limit checks ─────────────────────────────────────────────────

async def check_login_rate_limit(request: Request) -> None:
    """Sliding-window rate limit for FAILED login attempts.

    Only called when the login actually fails — successful logins never consume
    quota.  Limit: LOGIN_RATE_LIMIT per IP per 15 minutes.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:login:{ip}",
        max_requests=settings.LOGIN_RATE_LIMIT,
        window_seconds=900,
        message="Too many failed login attempts. Try again in 15 minutes.",
    )


async def check_forgot_password_rate_limit(request: Request) -> None:
    """Sliding-window limit for forgot-password requests.  FORGOT_PW_RATE_LIMIT per IP per hour."""
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:forgot_password:{ip}",
        max_requests=settings.FORGOT_PW_RATE_LIMIT,
        window_seconds=3600,
        message="Too many password reset requests. Try again in 1 hour.",
    )


async def check_resend_verification_rate_limit(request: Request) -> None:
    """3 requests per IP per hour (sliding window)."""
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:resend_verify:{ip}",
        max_requests=3,
        window_seconds=3600,
        message="Too many verification email requests. Try again in 1 hour.",
    )


async def check_reset_password_rate_limit(request: Request) -> None:
    """10 token submissions per IP per hour (sliding window)."""
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:reset_password:{ip}",
        max_requests=10,
        window_seconds=3600,
        message="Too many password reset attempts. Try again in 1 hour.",
    )


async def check_verify_email_rate_limit(request: Request) -> None:
    """10 email verification attempts per IP per hour (sliding window).

    Without this an attacker can probe for valid verification tokens or trigger
    a high volume of DB lookups against a public endpoint.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:verify_email:{ip}",
        max_requests=10,
        window_seconds=3600,
        message="Too many verification attempts. Try again in 1 hour.",
    )


async def check_invite_token_rate_limit(request: Request) -> None:
    """INVITE_TOKEN_RATE_LIMIT token operations per IP per hour (preview + accept combined).

    Both endpoints are public and accept a user-supplied token. Sharing a single
    Redis key keeps the combined attempt window tight.
    """
    ip = request.headers.get("X-Real-IP") or (
        request.client.host if request.client else "unknown"
    )
    await _sliding_window(
        key=f"rate:invite_token:{ip}",
        max_requests=settings.INVITE_TOKEN_RATE_LIMIT,
        window_seconds=3600,
        message="Too many invite token requests. Try again in 1 hour.",
    )


