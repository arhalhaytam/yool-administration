"""Shared async Redis client for the STT service.

A single module-level instance is lazily created on first use and reused
for all callers (JWT blocklist checks, rate limiting if added, pub/sub).
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
            max_connections=10,
        )
    return _redis
