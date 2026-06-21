"""Periodic housekeeping tasks for the auth service.

Each task is a plain async function that opens its own DB session so it can
be called from two places:
  1. The lifespan scheduler loop  (runs automatically every N hours)
  2. The admin endpoint           (manual on-demand trigger)

The scheduler loop is started in main.py lifespan and cancelled on shutdown.
"""

import asyncio
from datetime import datetime, timezone

import structlog
from sqlalchemy import delete

from shared.database import async_session_maker
from shared.models import EmailVerificationToken, PasswordResetToken

log = structlog.get_logger()


async def purge_expired_tokens() -> dict[str, int]:
    """Bulk-delete all expired one-time tokens from the database.

    Opens its own session so it works both from the scheduler loop and from
    the admin endpoint (which already has a separate session open).

    Returns counts of deleted rows per table.
    """
    now = datetime.now(timezone.utc)
    async with async_session_maker() as db:
        prt = await db.execute(
            delete(PasswordResetToken).where(PasswordResetToken.expires_at <= now)
        )
        evt = await db.execute(
            delete(EmailVerificationToken).where(EmailVerificationToken.expires_at <= now)
        )
        await db.commit()

    counts = {
        "password_reset_tokens_deleted": prt.rowcount,
        "email_verification_tokens_deleted": evt.rowcount,
    }
    log.info("tasks.token_cleanup", **counts)
    return counts


async def run_cleanup_loop(interval_hours: int = 24) -> None:
    """Run purge_expired_tokens immediately at startup, then every `interval_hours`.

    Designed to be launched with asyncio.create_task() inside the FastAPI
    lifespan.  Errors are caught and logged so a transient DB outage doesn't
    kill the loop.
    """
    while True:
        try:
            await purge_expired_tokens()
        except Exception as exc:
            log.error("tasks.token_cleanup.failed", error=str(exc))
        await asyncio.sleep(interval_hours * 3600)
