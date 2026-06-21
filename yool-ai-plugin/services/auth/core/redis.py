"""Shared async Redis client for the auth service.

A single module-level instance is created lazily on first use and reused for
all callers (blocklist checks, rate limiting).  Previously each module created
its own pool; this consolidates them into one.
"""

import redis.asyncio as aioredis

from core.config import settings

_redis: aioredis.Redis | None = None


def get_redis() -> aioredis.Redis:
    global _redis
    if _redis is None:
        _redis = aioredis.from_url(
            settings.REDIS_URL,
            encoding="utf-8",
            decode_responses=True,
            max_connections=20,
        )
    return _redis
