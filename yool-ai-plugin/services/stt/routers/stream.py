"""WebSocket stream endpoint — real-time audio ingestion.

Enterprise pivot:
- No more live partial summaries. The teacher sees only the live transcript
  while recording; the topic outline is generated once when they press Stop.
"""

import asyncio
import json
import uuid
from contextlib import suppress
from datetime import datetime, timezone
from typing import Annotated

import structlog
from fastapi import APIRouter, Query, WebSocket, WebSocketDisconnect, status, Depends, HTTPException, Request
from jose import JWTError, jwt
from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.config import settings
from core.redis import get_redis
from pipeline.embed_text import build_searchable_text
from pipeline.finalize_worker import get_finalize_worker
from pipeline.processor import FinalizeRejected, SessionProcessor
from shared.database import async_session_maker, get_session
from shared.models import AuditLog, Session as DBSession, SessionStatus, Summary, Chapter, Course, Matiere, Level, Transcript, User, UserRole
from core.dependencies import get_current_user, require_role

log = structlog.get_logger()
router = APIRouter()

# Only one STT finalizer should persist rows per session (duplicate browser tabs).
_FINALIZE_LOCK_PREFIX = "stt:finalize:"
_FINALIZE_LOCK_TTL_SEC = 600
_FINALIZE_POLL_INTERVAL_SEC = 2.0
_FINALIZE_POLL_ATTEMPTS = 90
_STOP_SIGNAL_GRACE_SECONDS = 3.0
_QUEUE_KEY = "stt:jobs"
_PROCESSING_QUEUE_KEY = "stt:jobs:processing"
_DLQ_KEY = "stt:jobs:dlq"
_MAX_DLQ_REQUEUE_BATCH = 50


def _resolve_stop_from_db_status(db_status: SessionStatus | None) -> tuple[bool, bool]:
    """Map DB session status to (stop_requested, should_end_listener)."""
    if db_status == SessionStatus.PROCESSING:
        return True, True
    if db_status in (SessionStatus.FAILED, SessionStatus.DONE):
        return False, True
    return False, False


def _get_client_ip(request: Request) -> str | None:
    return request.headers.get("X-Real-IP") or (
        request.client.host if request.client else None
    )


def _write_audit_log(
    db: AsyncSession,
    user_id: uuid.UUID | None,
    action: str,
    resource_type: str,
    resource_id: str | None,
    request: Request,
) -> None:
    db.add(AuditLog(
        user_id=user_id,
        action=action,
        resource_type=resource_type,
        resource_id=resource_id,
        ip_address=_get_client_ip(request),
        user_agent=request.headers.get("User-Agent"),
    ))


def _safe_job_preview(raw: str) -> dict:
    try:
        payload = json.loads(raw)
    except Exception:
        return {"valid_json": False, "preview": raw[:200]}
    transcript_text = payload.get("transcript_text", "")
    return {
        "valid_json": True,
        "session_id": payload.get("session_id"),
        "attempt": int(payload.get("attempt", 0)),
        "enqueued_at": payload.get("enqueued_at"),
        "last_failed_at": payload.get("last_failed_at"),
        "last_error": payload.get("last_error"),
        "transcript_length": len(transcript_text) if isinstance(transcript_text, str) else None,
        "context_keys": sorted((payload.get("context_metadata") or {}).keys()),
    }


async def _authenticate_ws(token: str) -> dict:
    """Validate JWT from WebSocket query param."""
    try:
        payload = jwt.decode(token, settings.jwt_public_key, algorithms=[settings.JWT_ALGORITHM])
    except JWTError:
        return {}
    jti: str | None = payload.get("jti")
    if jti:
        try:
            if await get_redis().exists(f"jwt:blocklist:{jti}"):
                return {}
        except Exception as e:
            log.error("ws.jwt_blocklist_check_failed", error=str(e))
            return {}
    return payload


@router.websocket("/sessions/{session_id}/stream")
async def audio_stream(
    websocket: WebSocket,
    session_id: uuid.UUID,
    token: Annotated[str, Query()],
):
    """
    Real-time audio streaming.

    Client → server: binary frames of raw PCM int16, 16kHz mono.
    Server → client JSON frames:
        {"type": "transcript", "speaker_role": "<teacher|participant|unknown>", "text": "...", "language": "fr"}
        {"type": "status", "message": "..."}
        {"type": "topic_outline", "content": {...}}      # final, on Stop
        {"type": "error", "message": "..."}
    """
    payload = await _authenticate_ws(token)
    if not payload:
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    user_id = payload.get("sub")
    user_role = payload.get("role")

    # super_admin is allowed too — admins may need to take over a session.
    if user_role not in ("teacher", "admin", "super_admin"):
        await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
        return

    async with async_session_maker() as db:
        result = await db.execute(
            select(DBSession)
            .options(
                selectinload(DBSession.chapter)
                .selectinload(Chapter.course)
                .selectinload(Course.matiere),
                selectinload(DBSession.chapter)
                .selectinload(Chapter.course)
                .selectinload(Course.level),
            )
            .where(
                DBSession.id == session_id,
                DBSession.status == SessionStatus.LIVE,
            )
        )
        sess = result.scalar_one_or_none()
        if not sess:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return
        # Teachers may only stream into their own session; admins bypass.
        if user_role == "teacher" and str(sess.teacher_id) != user_id:
            await websocket.close(code=status.WS_1008_POLICY_VIOLATION)
            return

        # Priming prompt for Whisper vocabulary — use chapter title, matiere, and level.
        # IMPORTANT: only used for the FIRST chunk to seed vocabulary; cleared immediately
        # after to prevent Whisper from hallucinating the prompt on subsequent silent chunks.
        prompt_words = []
        if sess.chapter:
            if sess.chapter.title:
                prompt_words.append(sess.chapter.title)
            if sess.chapter.course:
                if sess.chapter.course.matiere:
                    prompt_words.append(sess.chapter.course.matiere.name)
                if sess.chapter.course.level:
                    prompt_words.append(sess.chapter.course.level.name)
        initial_prompt = ", ".join(prompt_words) if prompt_words else None

    await websocket.accept()
    log.info("ws.connected", session_id=str(session_id), user_id=user_id)

    redis = get_redis()
    processor = SessionProcessor(session_id=session_id, redis=redis)
    if initial_prompt:
        processor.initial_prompt = initial_prompt
        processor._initial_prompt_used = False  # will be cleared after first chunk

    end_event = asyncio.Event()
    stop_requested = False
    disconnected = False

    async def _listen_for_end():
        nonlocal stop_requested
        pubsub = redis.pubsub()
        channel = f"session:end:{session_id}"
        try:
            await pubsub.subscribe(channel)
            poll_count = 0
            while not end_event.is_set():
                try:
                    message = await pubsub.get_message(
                        ignore_subscribe_messages=True,
                        timeout=_FINALIZE_POLL_INTERVAL_SEC,
                    )
                except Exception as e:
                    log.error("ws.end_listener_pubsub_error", session_id=str(session_id), error=str(e))
                    message = None

                if message and message.get("type") == "message":
                    stop_requested = True
                    end_event.set()
                    break

                # Fallback when Redis pub/sub delivery fails: infer stop intent from DB state.
                poll_count += 1
                if poll_count % 3 != 0:
                    continue
                if poll_count == _FINALIZE_POLL_ATTEMPTS:
                    log.warning(
                        "ws.end_listener_waiting_on_stop_signal",
                        session_id=str(session_id),
                        hint="No pubsub end signal yet; relying on DB status fallback.",
                    )
                if poll_count >= _FINALIZE_POLL_ATTEMPTS:
                    poll_count = 0
                async with async_session_maker() as db:
                    result = await db.execute(
                        select(DBSession.status).where(DBSession.id == session_id)
                    )
                    db_status = result.scalar_one_or_none()
                inferred_stop, should_end = _resolve_stop_from_db_status(db_status)
                if inferred_stop:
                    stop_requested = True
                    end_event.set()
                    break
                if should_end:
                    end_event.set()
                    break
        finally:
            with suppress(Exception):
                await pubsub.unsubscribe(channel)
            with suppress(Exception):
                await pubsub.close()

    end_listener = asyncio.create_task(_listen_for_end())

    async def _processing_worker():
        while not end_event.is_set():
            try:
                await asyncio.sleep(0.5)
                if processor.has_full_chunk():
                    segment = await processor.process_next_chunk()
                    if segment:
                        with suppress(Exception):
                            await websocket.send_json({
                                "type": "transcript",
                                "speaker_role": segment["speaker_role"],
                                "text": segment["text"],
                                "language": segment["language"],
                                "start_ms": segment["segment_start_ms"],
                                "end_ms": segment["segment_end_ms"],
                            })
            except asyncio.CancelledError:
                break
            except Exception as e:
                log.error("worker.error", error=str(e))

    worker_task = asyncio.create_task(_processing_worker())

    try:
        while not end_event.is_set():
            try:
                data = await asyncio.wait_for(websocket.receive_bytes(), timeout=1.0)
            except asyncio.TimeoutError:
                continue
            except (WebSocketDisconnect, RuntimeError):
                log.info("ws.disconnected", session_id=str(session_id))
                disconnected = True
                break

            # Intercept client binary heartbeat (pings are empty 2-byte frames)
            if len(data) < 10:
                with suppress(Exception):
                    await websocket.send_json({"type": "pong"})
                continue

            processor.add_audio_chunk(data)

        # If socket dropped, give a short grace window for near-simultaneous /end.
        if disconnected and not stop_requested:
            deadline = asyncio.get_running_loop().time() + _STOP_SIGNAL_GRACE_SECONDS
            while asyncio.get_running_loop().time() < deadline and not stop_requested:
                await asyncio.sleep(0.2)

        # Wait for the worker task to finish its current processing gracefully.
        if not end_event.is_set():
            end_event.set()
        await worker_task

        # Strict production behavior: only explicit POST /end may trigger finalization.
        if not stop_requested:
            log.warning(
                "ws.ended_without_stop_signal",
                session_id=str(session_id),
                disconnected=disconnected,
                hint="WebSocket ended before receiving session:end signal.",
            )
            with suppress(Exception):
                await websocket.send_json({
                    "type": "error",
                    "message": "Stream closed before Stop. Topic outline generation was cancelled.",
                })
            async with async_session_maker() as db:
                result = await db.execute(select(DBSession).where(DBSession.id == session_id))
                sess_obj = result.scalar_one_or_none()
                if sess_obj and sess_obj.status in (SessionStatus.LIVE, SessionStatus.PROCESSING):
                    sess_obj.status = SessionStatus.FAILED
                    sess_obj.ended_at = datetime.now(timezone.utc)
                await db.commit()
            with suppress(Exception):
                await websocket.close()
            return

        # Launch background drain task — persists transcripts and enqueues the LLM job
        async def _drain_and_finalize(proc, sess_id):
            log.info("background_drain.started", session_id=str(sess_id))
            try:
                # 1. Drain any remaining buffered audio
                while proc.has_full_chunk():
                    await proc.process_next_chunk()

                await proc.flush_tail()
                if len(proc.full_transcript_text.strip()) < 50:
                    log.warning(
                        "background_drain.transcript_too_short",
                        session_id=str(sess_id),
                        transcript_length=len(proc.full_transcript_text.strip()),
                    )
                    async with async_session_maker() as db:
                        await db.execute(
                            update(DBSession)
                            .where(DBSession.id == sess_id)
                            .values(status=SessionStatus.FAILED)
                        )
                        await db.commit()
                    return

                # 2. Distributed lock — only one tab/reconnect should finalize
                lock_key = f"{_FINALIZE_LOCK_PREFIX}{sess_id}"
                got_lock = await redis.set(lock_key, "1", nx=True, ex=_FINALIZE_LOCK_TTL_SEC)
                if not got_lock:
                    log.info("background_drain.lock_held", session_id=str(sess_id))
                    return
                try:
                    # 3. Persist transcript rows to DB (commits before LLM call)
                    async with async_session_maker() as db:
                        try:
                            context_metadata = await proc.persist_transcripts(db)
                        except FinalizeRejected as fr:
                            log.warning("background_drain.rejected", session_id=str(sess_id), reason=str(fr))
                            await db.execute(update(DBSession).where(DBSession.id == sess_id).values(status=SessionStatus.FAILED))
                            await db.commit()
                            return

                        # 4. Mark PROCESSING so the frontend knows LLM is running
                        await db.execute(
                            update(DBSession)
                            .where(DBSession.id == sess_id)
                            .values(
                                status=SessionStatus.PROCESSING,
                                dominant_language=proc.dominant_language,
                            )
                        )
                        await db.commit()

                    # 5. Enqueue the LLM summarization job — worker handles DONE/FAILED
                    finalize_payload = proc.build_finalize_payload()
                    await get_finalize_worker().enqueue(
                        session_id=sess_id,
                        transcript_text=finalize_payload["transcript_text"],
                        dominant_language=finalize_payload["dominant_language"],
                        context_metadata=context_metadata,
                    )
                finally:
                    with suppress(Exception):
                        await redis.delete(lock_key)

                log.info("background_drain.finished", session_id=str(sess_id))

            except Exception as e:
                log.error("background_drain.error", session_id=str(sess_id), error=str(e))
                async with async_session_maker() as db:
                    result = await db.execute(select(DBSession).where(DBSession.id == sess_id))
                    sess_obj = result.scalar_one_or_none()
                    if sess_obj and sess_obj.status not in (SessionStatus.DONE, SessionStatus.FAILED):
                        sess_obj.status = SessionStatus.FAILED
                        if sess_obj.ended_at is None:
                            sess_obj.ended_at = datetime.now(timezone.utc)
                    await db.commit()

        asyncio.create_task(_drain_and_finalize(processor, session_id))

        with suppress(Exception):
            await websocket.send_json({"type": "status", "message": "Generating topic outline..."})
        with suppress(Exception):
            await websocket.close()

    except Exception as e:
        log.error("ws.error", session_id=str(session_id), error=str(e))
        with suppress(Exception):
            await websocket.send_json({"type": "error", "message": "Processing error"})
        with suppress(Exception):
            await websocket.close()

        async with async_session_maker() as db:
            result = await db.execute(select(DBSession).where(DBSession.id == session_id))
            sess_obj = result.scalar_one_or_none()
            if sess_obj and sess_obj.status not in (SessionStatus.DONE, SessionStatus.FAILED):
                sess_obj.status = SessionStatus.FAILED
                if sess_obj.ended_at is None:
                    sess_obj.ended_at = datetime.now(timezone.utc)
            await db.commit()
    finally:
        end_listener.cancel()
        log.info("ws.closed", session_id=str(session_id))


@router.post("/sessions/{session_id}/retry")
async def retry_summary(
    session_id: uuid.UUID,
    request: Request,
    db: Annotated[async_session_maker, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """
    Manually trigger topic outline generation for a session that has finished
    recording but failed to generate a summary (e.g., due to LLM quota limits).
    """
    # 1. Fetch session and check access
    result = await db.execute(
        select(DBSession)
        .options(
            selectinload(DBSession.chapter)
            .selectinload(Chapter.course)
            .selectinload(Course.matiere),
            selectinload(DBSession.chapter)
            .selectinload(Chapter.course)
            .selectinload(Course.level),
        )
        .where(DBSession.id == session_id)
    )
    sess = result.scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")

    if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        if user.role != UserRole.TEACHER or sess.teacher_id != user.id:
            raise HTTPException(status_code=403, detail="Not your session")

    # 2. Check status
    if sess.status not in (SessionStatus.DONE, SessionStatus.FAILED):
        raise HTTPException(status_code=400, detail=f"Session is still {sess.status.value}, cannot retry yet.")

    # 3. Check if summary already exists
    summary_result = await db.execute(select(Summary).where(Summary.session_id == session_id))
    if summary_result.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Topic outline already exists for this session.")

    # 4. Fetch transcripts
    tx_result = await db.execute(
        select(Transcript)
        .where(Transcript.session_id == session_id)
        .order_by(Transcript.segment_start_ms)
    )
    transcripts = tx_result.scalars().all()
    
    if not transcripts:
        raise HTTPException(status_code=400, detail="No transcripts found for this session. Cannot generate outline.")

    # 5. Reconstruct text and metadata
    full_text_lines = []
    for tx in transcripts:
        full_text_lines.append(f"{tx.speaker_label}: {tx.text}")
    full_transcript_text = "\n".join(full_text_lines)
    
    if len(full_transcript_text.strip()) < 50:
        raise HTTPException(status_code=400, detail="Transcript is too short to summarize.")

    context_metadata = {
        "course_title": (
            f"{sess.chapter.course.matiere.name} - {sess.chapter.course.level.name}"
            if sess.chapter and sess.chapter.course
               and sess.chapter.course.matiere and sess.chapter.course.level
            else None
        ),
        "chapter_title": sess.chapter.title if sess.chapter else None,
        "matiere": sess.chapter.course.matiere.name if sess.chapter and sess.chapter.course and sess.chapter.course.matiere else None,
        "level": sess.chapter.course.level.name if sess.chapter and sess.chapter.course and sess.chapter.course.level else None,
    }

    dominant_lang = sess.dominant_language or "en"
    
    # 6. Generate outline
    from pipeline.summarizer import generate_topic_outline
    try:
        outline = await generate_topic_outline(full_transcript_text, dominant_lang, context_metadata)
    except Exception as e:
        log.error("retry_summary.generation_failed", session_id=str(session_id), error=str(e))
        raise HTTPException(status_code=503, detail="Failed to generate topic outline. Please try again later.")
    topics = outline.get("topics")
    if not isinstance(topics, list) or len(topics) == 0:
        raise HTTPException(
            status_code=503,
            detail="Topic outline generation returned no topics. Please retry later.",
        )

    # Format the topics
    outline["session_title"] = sess.title
    outline["course_title"] = context_metadata["course_title"] or ""
    
    # Get teacher name
    teacher_res = await db.execute(select(User).where(User.id == sess.teacher_id))
    teacher = teacher_res.scalar_one_or_none()
    outline["teacher_name"] = teacher.full_name if teacher else "Unknown Teacher"
    
    outline["recorded_at"] = sess.started_at.isoformat() if sess.started_at else datetime.now(timezone.utc).isoformat()

    # 7. Generate embedding and save
    new_summary = Summary(
        id=uuid.uuid4(),
        session_id=session_id,
        content=outline,
    )
    
    # Try embedding but don't fail if it doesn't work
    try:
        from pipeline.summarizer import generate_embedding
        emb = await generate_embedding(build_searchable_text(outline))
        new_summary.embedding = emb
    except Exception as e:
        log.warning("retry_summary.embedding_failed", session_id=str(session_id), error=str(e))

    db.add(new_summary)
    
    if sess.status == SessionStatus.FAILED:
        sess.status = SessionStatus.DONE

    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise HTTPException(
            status_code=409,
            detail="Topic outline already exists for this session.",
        )
    log.info("retry_summary.success", session_id=str(session_id))
    
    return {"status": "success", "summary_id": new_summary.id}


@router.get("/admin/finalize-queue")
async def get_finalize_queue_status(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.ADMIN))],
    include_dlq_samples: Annotated[bool, Query()] = False,
    dlq_sample_limit: Annotated[int, Query(ge=1, le=10)] = 3,
):
    redis = get_redis()
    queued, processing, dead_letter = await asyncio.gather(
        redis.llen(_QUEUE_KEY),
        redis.llen(_PROCESSING_QUEUE_KEY),
        redis.llen(_DLQ_KEY),
    )
    dlq_samples = []
    if include_dlq_samples and dead_letter > 0:
        sample_end = min(dead_letter - 1, dlq_sample_limit - 1)
        rows = await redis.lrange(_DLQ_KEY, 0, sample_end)
        dlq_samples = [_safe_job_preview(raw) for raw in rows]

    _write_audit_log(
        db=db,
        user_id=user.id,
        action="stt.finalize_queue.inspect",
        resource_type="stt_queue",
        resource_id="finalize",
        request=request,
    )
    await db.commit()

    return {
        "queued": int(queued),
        "processing": int(processing),
        "dead_letter": int(dead_letter),
        "dlq_samples": dlq_samples,
    }


@router.post("/admin/finalize-queue/requeue-dlq")
async def requeue_dead_letter_jobs(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.ADMIN))],
    limit: Annotated[int, Query(ge=1, le=_MAX_DLQ_REQUEUE_BATCH)] = 10,
):
    redis = get_redis()
    moved = 0
    while moved < limit:
        raw = await redis.lpop(_DLQ_KEY)
        if raw is None:
            break
        await redis.rpush(_QUEUE_KEY, raw)
        moved += 1

    remaining = await redis.llen(_DLQ_KEY)
    _write_audit_log(
        db=db,
        user_id=user.id,
        action="stt.finalize_queue.requeue_dlq",
        resource_type="stt_queue",
        resource_id=f"moved:{moved}",
        request=request,
    )
    await db.commit()

    return {
        "status": "ok",
        "moved": moved,
        "remaining_dead_letter": int(remaining),
    }

