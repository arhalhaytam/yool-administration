"""
Backfill script — generate embeddings for all Summary rows that have
embedding = NULL (sessions finalized before the OpenAI key was active).

Run this ONCE from inside the yool-ai-plugin directory:
  docker compose exec query python /tmp/backfill_embeddings.py

Or run it locally (with the right DATABASE_URL and OPENAI_API_KEY in env):
  python scripts/backfill_embeddings.py
"""

import asyncio
import os
import sys

# ── Make sure the shared package is importable ────────────────────────────────
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import openai
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.orm import sessionmaker

DATABASE_URL = os.environ["DATABASE_URL"]  # postgresql+asyncpg://...
OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
EMBED_MODEL = os.environ.get("OPENAI_EMBED_MODEL", "text-embedding-3-small")

engine = create_async_engine(DATABASE_URL, echo=False)
AsyncSessionMaker = sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

client = openai.AsyncOpenAI(api_key=OPENAI_API_KEY)


def build_searchable_text(outline: dict) -> str:
    parts = [
        outline.get("course_title", ""),
        outline.get("session_title", ""),
    ]
    for topic in outline.get("topics", []) or []:
        parts.append(topic.get("title", ""))
        parts.append(topic.get("description", ""))
        parts.extend(topic.get("key_concepts", []) or [])
    return " ".join(p for p in parts if p).strip()


async def embed(text: str) -> list[float]:
    result = await client.embeddings.create(
        model=EMBED_MODEL,
        input=text,
        dimensions=768,
    )
    return result.data[0].embedding


async def main():
    # Import models here so the path insert above takes effect first
    from shared.models import Summary  # noqa: PLC0415

    async with AsyncSessionMaker() as db:
        result = await db.execute(
            select(Summary).where(Summary.embedding.is_(None))
        )
        summaries = result.scalars().all()

    print(f"Found {len(summaries)} summaries with NULL embeddings.")
    if not summaries:
        print("Nothing to do.")
        return

    ok = 0
    failed = 0
    for summary in summaries:
        text = build_searchable_text(
            summary.content if isinstance(summary.content, dict) else {}
        )
        if not text.strip():
            print(f"  SKIP  {summary.session_id} — empty searchable text")
            continue
        try:
            vec = await embed(text)
            async with AsyncSessionMaker() as db:
                s = await db.get(Summary, summary.id)
                if s:
                    s.embedding = vec
                    await db.commit()
            print(f"  OK    {summary.session_id}")
            ok += 1
            await asyncio.sleep(0.2)  # avoid rate limit
        except Exception as e:
            print(f"  FAIL  {summary.session_id} — {e}")
            failed += 1

    print(f"\nDone. {ok} embedded, {failed} failed.")


if __name__ == "__main__":
    asyncio.run(main())
