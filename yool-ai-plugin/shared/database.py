"""Async SQLAlchemy engine and session factory shared across all services."""

import os
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

DATABASE_URL: str = os.environ["DATABASE_URL"]

# All ORM models that map to PostgreSQL native enum columns use
# `native_enum=False` so that SQLAlchemy sends the enum member's .value
# (e.g. "created") as a plain string instead of the Python member .name
# (e.g. "CREATED").  PostgreSQL accepts the text via implicit cast to the
# column's enum type, so no special asyncpg codec is required.

engine = create_async_engine(
    DATABASE_URL,
    pool_size=10,
    max_overflow=20,
    pool_pre_ping=True,       # reconnect on stale connections
    pool_recycle=3600,        # recycle connections every hour
    echo=os.getenv("ENVIRONMENT") == "development",
)

async_session_maker = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autoflush=False,
)


async def get_session() -> AsyncSession:
    """FastAPI dependency — yields an async DB session with auto commit/rollback."""
    async with async_session_maker() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
