"""Redis-backed cache for query embeddings."""

import asyncio
import hashlib
import json

import openai
import structlog

from core.config import settings
from core.redis import get_redis

log = structlog.get_logger()
_client = openai.AsyncOpenAI(api_key=settings.OPENAI_API_KEY)

EMBED_CACHE_TTL = 7 * 24 * 3600  # 7 days


class EmbeddingUnavailable(Exception):
    """Raised when OpenAI embedding fails after all retries."""


def _normalize_query(query: str) -> str:
    return " ".join(query.lower().strip().split())


def _cache_key(query: str) -> str:
    digest = hashlib.sha256(_normalize_query(query).encode("utf-8")).hexdigest()
    return f"embed:query:{digest}"


async def get_or_embed(query: str) -> list[float]:
    """Return a 768-dim query vector, using Redis when available.

    Uses OpenAI text-embedding-3-small with dimensions=768 to match the
    existing pgvector Vector(768) column — no database migration required.
    """
    redis = get_redis()
    key = _cache_key(query)
    cached = await redis.get(key)
    if cached:
        return json.loads(cached)

    query_text = query.strip()
    max_attempts = 3
    last_err = ""
    for attempt in range(1, max_attempts + 1):
        try:
            embed_result = await _client.embeddings.create(
                model=settings.OPENAI_EMBED_MODEL,
                input=query_text,
                dimensions=768,
            )
            vec = embed_result.data[0].embedding
            await redis.set(key, json.dumps(vec), ex=EMBED_CACHE_TTL)
            return vec
        except openai.RateLimitError as e:
            last_err = str(e)
            # "insufficient_quota" is a permanent billing error — retrying
            # wastes time (30 s + 60 s) for no benefit. Fail immediately.
            if "insufficient_quota" in last_err or "quota" in last_err.lower():
                log.error("cache.embed_quota_exceeded", error=last_err[:200])
                raise EmbeddingUnavailable("OpenAI quota exceeded — add credits to your account.") from e
            if attempt < max_attempts:
                await asyncio.sleep(30 * attempt)
                continue
            log.error("cache.embed_failed", attempt=attempt, error=last_err[:200])
            raise EmbeddingUnavailable(last_err) from e
        except Exception as e:
            last_err = str(e)
            log.error("cache.embed_failed", attempt=attempt, error=last_err[:200])
            raise EmbeddingUnavailable(last_err) from e

    raise EmbeddingUnavailable(last_err)
