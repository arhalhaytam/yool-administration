"""Background worker that pops finalization jobs from a Redis queue and
runs the LLM summarization + embedding pipeline.

Fix 4: Decouples the LLM call from the WebSocket drain path.

Flow
----
1. WebSocket drain task calls ``FinalizeWorker.enqueue(...)`` after
   persisting transcript rows to the DB. Session status is set to
   PROCESSING and the WebSocket closes immediately.
2. The worker's ``_run_loop`` coroutine (started with the FastAPI lifespan)
   atomically claims jobs from ``stt:jobs`` into ``stt:jobs:processing``
   before processing and acknowledging them.
3. On success: session → DONE, Summary row written.
   On failure: session → FAILED (transcript rows are already safely committed,
   so the /retry endpoint can regenerate the summary later).
"""

import asyncio
import json
import uuid
from datetime import datetime, timezone

import structlog
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError

from core.redis import get_redis
from pipeline.embed_text import build_searchable_text
from pipeline.summarizer import generate_embedding, generate_topic_outline
from shared.database import async_session_maker
from shared.models import Session as DBSession, SessionStatus, Summary

log = structlog.get_logger()

_QUEUE_KEY = "stt:jobs"
_PROCESSING_QUEUE_KEY = "stt:jobs:processing"
_DLQ_KEY = "stt:jobs:dlq"
_BLPOP_TIMEOUT = 5  # seconds — allows clean shutdown checks
_MAX_JOB_RETRIES = 3


class FinalizeWorker:
    """Long-running async worker that processes finalization jobs from Redis.

    Start it once at app startup inside the FastAPI lifespan context manager.
    """

    def __init__(self) -> None:
        self._task: asyncio.Task | None = None
        self._stop_event = asyncio.Event()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def start(self) -> None:
        """Start the background worker loop."""
        self._stop_event.clear()
        self._task = asyncio.create_task(self._run_loop(), name="finalize-worker")
        log.info("finalize_worker.started")

    async def stop(self) -> None:
        """Signal the worker to stop and wait for it to finish its current job."""
        self._stop_event.set()
        if self._task and not self._task.done():
            try:
                await asyncio.wait_for(self._task, timeout=30)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()
        log.info("finalize_worker.stopped")

    @staticmethod
    async def enqueue(
        session_id: uuid.UUID,
        transcript_text: str,
        dominant_language: str,
        context_metadata: dict,
    ) -> None:
        """Push a finalization job onto the Redis queue.

        Called by the WebSocket drain task after transcript rows are committed.
        """
        job = {
            "session_id": str(session_id),
            "transcript_text": transcript_text,
            "dominant_language": dominant_language,
            "context_metadata": context_metadata,
            "enqueued_at": datetime.now(timezone.utc).isoformat(),
            "attempt": 0,
        }
        redis = get_redis()
        await redis.rpush(_QUEUE_KEY, json.dumps(job))
        log.info("finalize_worker.job_enqueued", session_id=str(session_id))

    # ------------------------------------------------------------------
    # Worker loop
    # ------------------------------------------------------------------

    async def _run_loop(self) -> None:
        redis = get_redis()
        await self._recover_stuck_jobs(redis)
        log.info("finalize_worker.loop_running")

        while not self._stop_event.is_set():
            try:
                # BRPOPLPUSH atomically claims one job to the processing queue.
                raw = await redis.brpoplpush(
                    _QUEUE_KEY,
                    _PROCESSING_QUEUE_KEY,
                    timeout=_BLPOP_TIMEOUT,
                )
                if raw is None:
                    continue  # timeout — loop again to check stop_event

                await self._process_claimed_job(redis, raw)

            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("finalize_worker.loop_error", error=str(e))
                await asyncio.sleep(2)

    async def _recover_stuck_jobs(self, redis) -> None:
        """Move any crash-left processing jobs back to the main queue."""
        moved = 0
        while True:
            raw = await redis.lpop(_PROCESSING_QUEUE_KEY)
            if raw is None:
                break
            await redis.rpush(_QUEUE_KEY, raw)
            moved += 1
        if moved:
            log.warning("finalize_worker.recovered_jobs", count=moved)

    async def _process_claimed_job(self, redis, raw: str) -> None:
        """Process one claimed job and ack/requeue safely."""
        try:
            job: dict = json.loads(raw)
        except Exception as e:
            log.error("finalize_worker.invalid_job_json", error=str(e), preview=str(raw)[:200])
            await redis.rpush(_DLQ_KEY, raw)
            await redis.lrem(_PROCESSING_QUEUE_KEY, 1, raw)
            return

        try:
            await self._process_job(job)
            await redis.lrem(_PROCESSING_QUEUE_KEY, 1, raw)
        except Exception as e:
            attempt = int(job.get("attempt", 0)) + 1
            job["attempt"] = attempt
            job["last_error"] = str(e)[:500]
            job["last_failed_at"] = datetime.now(timezone.utc).isoformat()
            await redis.lrem(_PROCESSING_QUEUE_KEY, 1, raw)
            if attempt <= _MAX_JOB_RETRIES:
                await redis.rpush(_QUEUE_KEY, json.dumps(job))
                log.warning(
                    "finalize_worker.job_requeued",
                    session_id=job.get("session_id"),
                    attempt=attempt,
                )
                return
            await redis.rpush(_DLQ_KEY, json.dumps(job))
            log.error(
                "finalize_worker.job_dead_lettered",
                session_id=job.get("session_id"),
                attempt=attempt,
            )

    async def _process_job(self, job: dict) -> None:
        session_id_str = job.get("session_id", "unknown")
        log.info("finalize_worker.processing", session_id=session_id_str)

        try:
            session_id = uuid.UUID(session_id_str)
        except ValueError:
            log.error("finalize_worker.invalid_session_id", raw=session_id_str)
            return

        transcript_text: str = job.get("transcript_text", "")
        dominant_language: str = job.get("dominant_language", "fr")
        context_metadata: dict = job.get("context_metadata", {})

        try:
            # 1. Generate topic outline (with built-in 429 retry in summarizer)
            outline = await generate_topic_outline(
                transcript_text,
                dominant_language,
                context_metadata=context_metadata,
            )
            topics = outline.get("topics")
            if not isinstance(topics, list) or len(topics) == 0:
                raise ValueError("LLM returned empty/invalid topics; refusing DONE transition")

            # 2. Inject metadata fields from context (same as old finalize())
            outline["course_title"] = (
                f"{context_metadata.get('matiere_name', '')} - {context_metadata.get('level_name', '')}"
            )
            outline["chapter_title"] = context_metadata.get("chapter_title", "")
            outline["teacher_name"] = context_metadata.get("teacher_name", "")
            outline["session_title"] = context_metadata.get("session_title", "")
            outline["session_id"] = context_metadata.get("session_id", session_id_str)
            outline["recorded_at"] = context_metadata.get("recorded_at", "")

            # 3. Build searchable text and embed
            searchable_text = build_searchable_text(outline)

            embedding = await generate_embedding(searchable_text) if searchable_text else None

            # 4. Persist Summary and mark session DONE
            async with async_session_maker() as db:
                sess_status_result = await db.execute(
                    select(DBSession.status).where(DBSession.id == session_id).with_for_update()
                )
                sess_status = sess_status_result.scalar_one_or_none()
                if sess_status is None:
                    log.warning("finalize_worker.session_missing", session_id=session_id_str)
                    return
                if sess_status == SessionStatus.FAILED:
                    log.warning("finalize_worker.session_already_failed", session_id=session_id_str)
                    return
                if sess_status == SessionStatus.LIVE:
                    log.warning(
                        "finalize_worker.invalid_state_live",
                        session_id=session_id_str,
                        hint="Refusing LIVE -> DONE transition without explicit stop processing state.",
                    )
                    return
                if sess_status == SessionStatus.CREATED:
                    log.warning(
                        "finalize_worker.invalid_state_created",
                        session_id=session_id_str,
                    )
                    return

                existing = await db.execute(
                    select(Summary.id).where(Summary.session_id == session_id)
                )
                if existing.scalar_one_or_none():
                    await db.execute(
                        update(DBSession)
                        .where(DBSession.id == session_id)
                        .values(
                            status=SessionStatus.DONE,
                            ended_at=datetime.now(timezone.utc),
                        )
                    )
                    await db.commit()
                    log.info("finalize_worker.idempotent_summary_exists", session_id=session_id_str)
                    return

                db.add(Summary(
                    id=uuid.uuid4(),
                    session_id=session_id,
                    content=outline,
                    embedding=embedding,
                ))
                # Also set ended_at if it was never set (edge case: stream aborted and re-queued)
                await db.execute(
                    update(DBSession)
                    .where(DBSession.id == session_id)
                    .values(
                        status=SessionStatus.DONE,
                        ended_at=datetime.now(timezone.utc),
                    )
                )
                try:
                    await db.commit()
                except IntegrityError:
                    await db.rollback()
                    existing_after_conflict = await db.execute(
                        select(Summary.id).where(Summary.session_id == session_id)
                    )
                    if existing_after_conflict.scalar_one_or_none():
                        await db.execute(
                            update(DBSession)
                            .where(DBSession.id == session_id)
                            .values(
                                status=SessionStatus.DONE,
                                ended_at=datetime.now(timezone.utc),
                            )
                        )
                        await db.commit()
                        log.warning("finalize_worker.duplicate_summary_race_ignored", session_id=session_id_str)
                        return
                    raise

            log.info("finalize_worker.job_done", session_id=session_id_str)

        except Exception as e:
            log.error("finalize_worker.job_failed", session_id=session_id_str, error=str(e))
            # Mark session FAILED so the /retry endpoint can handle it later
            marked_failed = False
            try:
                async with async_session_maker() as db:
                    result = await db.execute(
                        select(DBSession).where(DBSession.id == session_id)
                    )
                    sess = result.scalar_one_or_none()
                    if sess and sess.status not in (SessionStatus.DONE, SessionStatus.FAILED):
                        sess.status = SessionStatus.FAILED
                        if sess.ended_at is None:
                            sess.ended_at = datetime.now(timezone.utc)
                    await db.commit()
                    marked_failed = True
            except Exception as db_err:
                log.error("finalize_worker.status_update_failed", error=str(db_err))
            if marked_failed:
                return
            raise


# Module-level singleton — imported by main.py and stream.py
_worker: FinalizeWorker | None = None


def get_finalize_worker() -> FinalizeWorker:
    """Return the module-level FinalizeWorker singleton."""
    global _worker
    if _worker is None:
        _worker = FinalizeWorker()
    return _worker
