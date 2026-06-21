"""Sessions router — full lifecycle, transcripts, topic outlines, and data retention.

Enterprise pivot:
- Per-session consent fields removed (consent is institutional, set elsewhere).
- Session creation is a single call: POST /{course_id}/start (create + go LIVE).
- Stop is always manual: teacher calls POST /{session_id}/end.
- The live partial-summary feed (and its endpoint) was removed entirely.
- Only assigned teachers + admins can read or mutate a session — students don't exist.
"""

import uuid
from datetime import datetime, timedelta, timezone
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import Float, cast as sa_cast, delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.config import settings
from core.dependencies import get_current_user, require_role
from core.rate_limit import check_purge_rate_limit, check_session_create_rate_limit
from core.redis import get_redis
from core.utils import write_audit_log as _audit
from shared.database import get_session
from shared.models import (
    Course, Session, SessionStatus,
    Summary, Transcript, User, UserRole,
)

log = structlog.get_logger()
router = APIRouter(redirect_slashes=False)


@router.get("/health", include_in_schema=False)
async def health():
    return {"status": "ok", "service": "session"}


# ── Schemas ───────────────────────────────────────────────────────────────────

class SessionStart(BaseModel):
    """Optional override of the auto-generated session title."""
    title: str | None = Field(default=None, min_length=2, max_length=255, strip_whitespace=True)


class SessionPatch(BaseModel):
    title: str = Field(min_length=2, max_length=255, strip_whitespace=True)


class SessionOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    title: str
    chapter_id:        uuid.UUID
    course_id:         uuid.UUID
    teacher_id:        uuid.UUID
    status:            SessionStatus
    dominant_language: str | None
    started_at:        datetime | None
    ended_at:          datetime | None
    created_at:        datetime


class SessionListPage(BaseModel):
    items: list[SessionOut]
    total: int
    limit: int
    offset: int
    has_more: bool


class SessionStatusSummary(BaseModel):
    total: int
    live: int
    processing: int
    done: int
    failed: int
    created: int


class TranscriptSegmentOut(BaseModel):
    model_config = {"from_attributes": True}
    id:               uuid.UUID
    speaker_role:     str
    speaker_label:    str
    text:             str
    language:         str
    segment_start_ms: int
    segment_end_ms:   int


class SummaryOut(BaseModel):
    model_config = {"from_attributes": True}
    id:         uuid.UUID
    session_id: uuid.UUID
    content:    dict
    created_at: datetime


class TeacherContextStat(BaseModel):
    teacher_id:      str
    teacher_name:    str
    in_context:      int
    out_of_context:  int


class SessionOverviewStats(BaseModel):
    total_hours_minutes: int
    avg_context_score:   float | None
    sessions_this_week:  int
    sessions_this_month: int
    recent_sessions:     list[dict]
    in_context:          int = 0
    out_of_context:      int = 0


# ── Access helpers ────────────────────────────────────────────────────────────

async def _get_session_or_404(session_id: uuid.UUID, db: AsyncSession) -> Session:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Session).options(selectinload(Session.chapter)).where(Session.id == session_id)
    )
    sess = result.scalar_one_or_none()
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    return sess


def _assert_teacher_owns(sess: Session, user: User) -> None:
    """Verify the user can mutate this session.

    ADMIN/SUPER_ADMIN bypass the ownership check so they can manage any session.
    """
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return
    if sess.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="Not your session")


def _assert_can_read_session(sess: Session, user: User) -> None:
    """Read access — same rules as mutation since students no longer exist."""
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return
    if user.role == UserRole.TEACHER:
        if sess.teacher_id != user.id:
            raise HTTPException(403, "Not your session")
        return
    raise HTTPException(403, "Insufficient role")


def _auto_session_title(chapter, when: datetime) -> str:
    """Deterministic auto-generated session title."""
    return f"{chapter.title} — {when:%Y-%m-%d %H:%M}"


# ── Session lifecycle ─────────────────────────────────────────────────────────

@router.post("/chapters/{chapter_id}/start", response_model=SessionOut, status_code=status.HTTP_201_CREATED)
async def start_session_for_chapter(
    chapter_id: uuid.UUID,
    body: SessionStart,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Single-call session create + go LIVE.

    Replaces the old two-step (create → start) flow.  The teacher taps a single
    Start button: a new Session row is inserted with status LIVE and the STT
    pipeline begins streaming.  Stop is the teacher's responsibility — no
    automatic end.
    """
    from shared.models import Chapter
    from sqlalchemy.orm import selectinload
    
    # Rate-limit AFTER RBAC and after we resolve the chapter, so 403/404 don't
    # burn the per-IP quota.
    result = await db.execute(
        select(Chapter).options(selectinload(Chapter.course)).where(Chapter.id == chapter_id)
    )
    chapter = result.scalar_one_or_none()
    
    if not chapter:
        raise HTTPException(404, "Chapter not found")
    if user.role == UserRole.TEACHER and chapter.course.teacher_id != user.id:
        raise HTTPException(403, "Course not assigned to you")

    await check_session_create_rate_limit(request)

    now = datetime.now(timezone.utc)
    title = body.title or _auto_session_title(chapter, now)
    sess = Session(
        id=uuid.uuid4(),
        title=title,
        chapter_id=chapter_id,
        chapter=chapter,
        teacher_id=user.id if user.role == UserRole.TEACHER else chapter.course.teacher_id,
        status=SessionStatus.LIVE,
        started_at=now,
    )
    db.add(sess)
    await db.flush()
    _audit(db, user.id, "session.started", "session", str(sess.id), request)
    log.info(
        "session.started",
        session_id=str(sess.id),
        chapter_id=str(chapter_id),
        teacher_id=str(sess.teacher_id),
    )
    return SessionOut.model_validate(sess)


@router.patch("/{session_id}", response_model=SessionOut)
async def update_session(
    session_id: uuid.UUID,
    body: SessionPatch,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Rename a session (allowed at any status)."""
    sess = await _get_session_or_404(session_id, db)
    _assert_teacher_owns(sess, user)

    sess.title = body.title
    _audit(db, user.id, "session.updated", "session", str(session_id), request)
    log.info("session.updated", session_id=str(session_id), by=str(user.id))
    return SessionOut.model_validate(sess)


@router.post("/{session_id}/end", response_model=SessionOut)
async def end_session(
    session_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Manual stop: teacher presses Stop.
    Transition LIVE → PROCESSING and publish the Redis end-event so the STT
    service generates the final topic outline.
    """
    sess = await _get_session_or_404(session_id, db)
    _assert_teacher_owns(sess, user)

    if sess.status != SessionStatus.LIVE:
        raise HTTPException(400, f"Session is not live (current status: '{sess.status.value}')")

    sess.status = SessionStatus.PROCESSING
    sess.ended_at = datetime.now(timezone.utc)

    _audit(db, user.id, "session.ended", "session", str(session_id), request)
    await db.commit()

    redis = get_redis()
    try:
        await redis.publish(f"session:end:{session_id}", "end")
    except Exception as e:
        log.error("session.end_publish_failed", session_id=str(session_id), error=str(e))
        # Do not fail after commit: STT also polls DB status as a fallback stop signal.
        # Returning success keeps API semantics aligned with persisted session state.

    log.info("session.ended", session_id=str(session_id))
    return SessionOut.model_validate(sess)


@router.post("/{session_id}/cancel", response_model=SessionOut)
async def cancel_session(
    session_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Cancel a session that was never completed.
    Allowed from CREATED or LIVE; transitions to FAILED (terminal).
    A LIVE session that is cancelled does NOT trigger STT processing.
    """
    sess = await _get_session_or_404(session_id, db)
    _assert_teacher_owns(sess, user)

    if sess.status not in (SessionStatus.CREATED, SessionStatus.LIVE):
        raise HTTPException(
            400,
            f"Cannot cancel a session in status '{sess.status.value}' "
            f"— only CREATED or LIVE sessions can be cancelled",
        )

    sess.status = SessionStatus.FAILED
    sess.ended_at = datetime.now(timezone.utc)
    _audit(db, user.id, "session.cancelled", "session", str(session_id), request)
    log.info("session.cancelled", session_id=str(session_id), by=str(user.id))
    return SessionOut.model_validate(sess)


# ── Session queries ───────────────────────────────────────────────────────────

def _session_list_filters(
    user: User,
    course_id: uuid.UUID | None,
    chapter_id: uuid.UUID | None,
    status: SessionStatus | None,
) -> list:
    """Shared WHERE clauses for session list + summary (visibility + optional filters)."""
    clauses = []
    if user.role == UserRole.TEACHER:
        clauses.append(Session.teacher_id == user.id)
    if course_id is not None:
        from shared.models import Chapter
        clauses.append(Session.chapter.has(Chapter.course_id == course_id))
    if chapter_id is not None:
        clauses.append(Session.chapter_id == chapter_id)
    if status is not None:
        clauses.append(Session.status == status)
    return clauses


@router.get("/", response_model=SessionListPage)
async def list_sessions(
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    limit:  int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0,  ge=0),
    course_id: uuid.UUID | None = Query(default=None, description="Filter by course"),
    chapter_id: uuid.UUID | None = Query(default=None, description="Filter by chapter"),
    status: SessionStatus | None = Query(default=None, description="Filter by session status"),
):
    """
    Paginated session list.

    Visibility:
    - ADMIN/SUPER_ADMIN → all sessions
    - TEACHER           → only sessions they taught
    """
    if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(403, "Insufficient role")

    filters = _session_list_filters(user, course_id, chapter_id, status)

    count_q = select(func.count(Session.id))
    for clause in filters:
        count_q = count_q.where(clause)
    total = int((await db.execute(count_q)).scalar() or 0)

    from sqlalchemy.orm import selectinload
    items_q = select(Session).options(selectinload(Session.chapter))
    for clause in filters:
        items_q = items_q.where(clause)
    items_q = items_q.order_by(Session.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    items = [SessionOut.model_validate(s) for s in result.scalars().all()]

    return SessionListPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


@router.get("/summary", response_model=SessionStatusSummary)
async def sessions_status_summary(
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    course_id: uuid.UUID | None = Query(default=None, description="Filter by course"),
    chapter_id: uuid.UUID | None = Query(default=None, description="Filter by chapter"),
):
    """Aggregate session counts by status (respects the same visibility rules as the list)."""
    if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(403, "Insufficient role")

    filters = _session_list_filters(user, course_id, chapter_id, None)

    q = select(Session.status, func.count(Session.id))
    for clause in filters:
        q = q.where(clause)
    q = q.group_by(Session.status)
    rows = await db.execute(q)
    by_status = {row[0]: int(row[1]) for row in rows.all()}

    return SessionStatusSummary(
        total=sum(by_status.values()),
        live=by_status.get(SessionStatus.LIVE, 0),
        processing=by_status.get(SessionStatus.PROCESSING, 0),
        done=by_status.get(SessionStatus.DONE, 0),
        failed=by_status.get(SessionStatus.FAILED, 0),
        created=by_status.get(SessionStatus.CREATED, 0),
    )


# ── Context adherence stats (declared BEFORE the `/{session_id}` catch-all
#    so it can never be shadowed by it) ───────────────────────────────────────

_CONTEXT_THRESHOLD = 0.6  # context_score >= threshold → in context


@router.get("/stats/teacher-context", response_model=list[TeacherContextStat])
async def teacher_context_stats(
    db: Annotated[AsyncSession, Depends(get_session)],
    _admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Per-teacher context adherence aggregated from all DONE sessions.

    For each teacher, counts how many of their completed sessions had a
    context_score >= 0.6 (in context) vs < 0.6 (out of context).

    Sessions recorded before context_score was introduced (missing key in JSONB)
    are treated as in-context (safe default).
    """
    result = await db.execute(
        select(Session, Summary, User)
        .join(Summary, Summary.session_id == Session.id)
        .join(User, User.id == Session.teacher_id)
        .where(Session.status == SessionStatus.DONE)
        .where(User.is_deleted == False)  # noqa: E712
        .order_by(User.id)
    )
    rows = result.all()

    stats: dict[str, dict] = {}
    for sess, summary, teacher in rows:
        tid = str(teacher.id)
        if tid not in stats:
            stats[tid] = {
                "teacher_id": tid,
                "teacher_name": teacher.full_name or teacher.email,
                "in_context": 0,
                "out_of_context": 0,
            }
        score = summary.content.get("context_score")
        try:
            score_f = float(score) if score is not None else 1.0
        except (TypeError, ValueError):
            score_f = 1.0

        if score_f >= _CONTEXT_THRESHOLD:
            stats[tid]["in_context"] += 1
        else:
            stats[tid]["out_of_context"] += 1

    return [TeacherContextStat(**v) for v in stats.values()]


@router.get("/stats/overview", response_model=SessionOverviewStats)
async def sessions_stats_overview(
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """
    Aggregate stats scoped to the requesting user's visibility.
    - TEACHER: their own sessions only.
    - ADMIN/SUPER_ADMIN: platform-wide.

    Returns hours recorded, average context score, weekly/monthly counts,
    and the 5 most-recent sessions for the quick-access list on the dashboard.
    """
    if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.TEACHER):
        raise HTTPException(403, "Insufficient role")

    base_filters = _session_list_filters(user, None, None, None)
    now = datetime.now(timezone.utc)

    # Total duration in minutes across all sessions that have both timestamps
    hours_q = (
        select(
            func.coalesce(
                func.sum(
                    func.extract("epoch", Session.ended_at - Session.started_at) / 60
                ),
                0,
            )
        )
        .select_from(Session)
        .where(Session.ended_at.isnot(None))
        .where(Session.started_at.isnot(None))
    )
    for clause in base_filters:
        hours_q = hours_q.where(clause)
    total_minutes = int((await db.execute(hours_q)).scalar() or 0)

    # Average context_score extracted from the JSONB summary content
    avg_q = (
        select(func.avg(sa_cast(Summary.content["context_score"].astext, Float)))
        .select_from(Session)
        .join(Summary, Summary.session_id == Session.id)
        .where(Session.status == SessionStatus.DONE)
    )
    for clause in base_filters:
        avg_q = avg_q.where(clause)
    avg_score_raw = (await db.execute(avg_q)).scalar()
    avg_score = round(float(avg_score_raw), 4) if avg_score_raw is not None else None

    # Sessions started in the last 7 / 30 days
    week_q = (
        select(func.count(Session.id))
        .select_from(Session)
        .where(Session.started_at >= now - timedelta(days=7))
    )
    for clause in base_filters:
        week_q = week_q.where(clause)
    sessions_this_week = int((await db.execute(week_q)).scalar() or 0)

    month_q = (
        select(func.count(Session.id))
        .select_from(Session)
        .where(Session.started_at >= now - timedelta(days=30))
    )
    for clause in base_filters:
        month_q = month_q.where(clause)
    sessions_this_month = int((await db.execute(month_q)).scalar() or 0)

    # 5 most-recent sessions for the dashboard quick-access list
    recent_q = (
        select(Session)
        .select_from(Session)
        .order_by(Session.started_at.desc().nullslast())
        .limit(5)
    )
    for clause in base_filters:
        recent_q = recent_q.where(clause)
    recent_rows = (await db.execute(recent_q)).scalars().all()
    recent_sessions = [
        {
            "id": str(s.id),
            "title": s.title,
            "status": s.status.value,
            "started_at": s.started_at.isoformat() if s.started_at else None,
        }
        for s in recent_rows
    ]

    # In-context vs out-of-context counts (DONE sessions with a summary)
    ctx_q = (
        select(
            func.count(Summary.id).filter(
                sa_cast(Summary.content["context_score"].astext, Float) >= _CONTEXT_THRESHOLD
            ).label("in_context"),
            func.count(Summary.id).filter(
                sa_cast(Summary.content["context_score"].astext, Float) < _CONTEXT_THRESHOLD
            ).label("out_of_context"),
        )
        .select_from(Session)
        .join(Summary, Summary.session_id == Session.id)
        .where(Session.status == SessionStatus.DONE)
    )
    for clause in base_filters:
        ctx_q = ctx_q.where(clause)
    ctx_row = (await db.execute(ctx_q)).first()
    in_context_count    = int(ctx_row.in_context    or 0) if ctx_row else 0
    out_of_context_count = int(ctx_row.out_of_context or 0) if ctx_row else 0

    return SessionOverviewStats(
        total_hours_minutes=total_minutes,
        avg_context_score=avg_score,
        sessions_this_week=sessions_this_week,
        sessions_this_month=sessions_this_month,
        recent_sessions=recent_sessions,
        in_context=in_context_count,
        out_of_context=out_of_context_count,
    )


@router.get("/{session_id}", response_model=SessionOut)
async def get_session_detail(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    sess = await _get_session_or_404(session_id, db)
    _assert_can_read_session(sess, user)
    return SessionOut.model_validate(sess)


# ── Transcript ────────────────────────────────────────────────────────────────

@router.get("/{session_id}/transcript", response_model=list[TranscriptSegmentOut])
async def get_transcript(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    limit:  int = Query(default=200, ge=1, le=1000),
    offset: int = Query(default=0,   ge=0),
):
    """Time-ordered transcript segments for the session."""
    sess = await _get_session_or_404(session_id, db)
    _assert_can_read_session(sess, user)

    result = await db.execute(
        select(Transcript)
        .where(Transcript.session_id == session_id)
        .order_by(Transcript.segment_start_ms)
        .limit(limit)
        .offset(offset)
    )
    return [TranscriptSegmentOut.model_validate(t) for t in result.scalars().all()]


# ── Final topic outline ───────────────────────────────────────────────────────

@router.get("/{session_id}/summary", response_model=SummaryOut)
async def get_summary(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """
    Returns the final self-contained topic outline for the session.
    Only available once status is DONE.
    """
    sess = await _get_session_or_404(session_id, db)
    _assert_can_read_session(sess, user)

    if sess.status != SessionStatus.DONE:
        raise HTTPException(
            409,
            f"Topic outline not ready — session status is '{sess.status.value}'",
        )

    result = await db.execute(select(Summary).where(Summary.session_id == session_id))
    summary = result.scalar_one_or_none()
    if not summary:
        raise HTTPException(404, "Topic outline not yet generated")
    return SummaryOut.model_validate(summary)


# ── Data retention (GDPR Art. 5 — storage limitation) ────────────────────────

@router.delete("/admin/purge", status_code=status.HTTP_200_OK)
async def purge_old_sessions(
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
    days: int = Query(
        default=settings.RETENTION_DAYS,
        ge=30,
        le=3650,
        description="Hard-delete DONE/FAILED sessions older than this many days",
    ),
):
    """
    Admin hard delete for GDPR Art. 5 storage-limitation compliance.
    Deletes DONE and FAILED sessions whose ended_at is older than `days` days.
    Cascades to transcripts and topic outlines at the DB level.
    """
    await check_purge_rate_limit(request)

    cutoff = datetime.now(timezone.utc) - timedelta(days=days)

    result = await db.execute(
        delete(Session)
        .where(
            Session.status.in_([SessionStatus.DONE, SessionStatus.FAILED]),
            Session.ended_at < cutoff,
        )
        .execution_options(synchronize_session=False)
    )
    count = result.rowcount

    _audit(db, admin.id, "admin.session_purge", "session", f"cutoff:{cutoff.date()}", request)
    log.info(
        "admin.retention_purge",
        count=count,
        cutoff=str(cutoff.date()),
        days=days,
        admin_id=str(admin.id),
    )
    return {"purged_sessions": count, "older_than_days": days, "cutoff": cutoff.isoformat()}
