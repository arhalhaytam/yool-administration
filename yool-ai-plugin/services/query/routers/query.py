"""Query router — topic outlines, transcripts, and semantic search.

Enterprise pivot: students no longer exist. Access is gated to:
  - the assigned teacher of the session, and
  - any admin / super_admin.
"""

import re
import uuid
from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from core.cache import EmbeddingUnavailable, get_or_embed
from core.dependencies import get_current_user, require_role
from shared.database import get_session
from shared.models import (
    Chapter,
    Course,
    Level,
    Matiere,
    Session,
    SessionStatus,
    Summary,
    Transcript,
    User,
    UserRole,
)

log = structlog.get_logger()
router = APIRouter(redirect_slashes=False)


# ── Access guard ──────────────────────────────────────────────────────────────

async def _assert_session_access(session_id: uuid.UUID, user: User, db: AsyncSession) -> Session:
    sess = await db.get(Session, session_id)
    if not sess:
        raise HTTPException(status_code=404, detail="Session not found")
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return sess
    if user.role == UserRole.TEACHER:
        if sess.teacher_id != user.id:
            raise HTTPException(status_code=403, detail="Not your session")
        return sess
    raise HTTPException(status_code=403, detail="Insufficient role")


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.get("/sessions/{session_id}/summary")
async def get_summary(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    sess = await _assert_session_access(session_id, user, db)
    if sess.status != SessionStatus.DONE:
        raise HTTPException(
            status_code=409,
            detail=f"Topic outline not ready — session status is '{sess.status.value}'",
        )
    result = await db.execute(select(Summary).where(Summary.session_id == session_id))
    summary = result.scalar_one_or_none()
    if not summary:
        raise HTTPException(status_code=404, detail="Topic outline not yet available")
    return {"session_id": str(session_id), "content": summary.content, "created_at": summary.created_at}


@router.get("/sessions/{session_id}/transcript")
async def get_transcript(
    session_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Transcript access: assigned teacher, admin, super_admin."""
    sess = await _assert_session_access(session_id, user, db)

    result = await db.execute(
        select(Transcript)
        .where(Transcript.session_id == sess.id)
        .order_by(Transcript.segment_start_ms)
    )
    segments = result.scalars().all()
    return {
        "session_id": str(session_id),
        "segments": [
            {
                "speaker_role": s.speaker_role.value,
                "text": s.text,
                "language": s.language,
                "start_ms": s.segment_start_ms,
                "end_ms": s.segment_end_ms,
            }
            for s in segments
        ],
    }


class SearchRequest(BaseModel):
    query: str = Field(min_length=2, max_length=2000)
    limit: int = Field(default=20, ge=1, le=50)
    offset: int = Field(default=0, ge=0)
    teacher_id: uuid.UUID | None = None
    course_id: uuid.UUID | None = None
    level_id: uuid.UUID | None = None
    matiere_id: uuid.UUID | None = None
    language: str | None = Field(default=None, max_length=10)


LEXICAL_BOOST = 0.20


def _parse_optional_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _escape_like(raw: str) -> str:
    return raw.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _pick_topic_snippet(query_text: str, topics: list[dict]) -> dict | None:
    if not topics:
        return None

    query_tokens = {
        tok for tok in re.findall(r"\w+", query_text.lower()) if len(tok) > 2
    }
    if not query_tokens:
        top = topics[0]
        return {
            "topic_title": top.get("title", ""),
            "topic_description": top.get("description", ""),
        }

    best_topic = topics[0]
    best_score = -1
    for topic in topics:
        text_parts = [
            topic.get("title", ""),
            topic.get("description", ""),
            *topic.get("key_concepts", []),
        ]
        topic_tokens = set(re.findall(r"\w+", " ".join(text_parts).lower()))
        score = len(query_tokens & topic_tokens)
        if score > best_score:
            best_score = score
            best_topic = topic

    return {
        "topic_title": best_topic.get("title", ""),
        "topic_description": best_topic.get("description", ""),
    }


@router.post("/search")
async def search(
    body: SearchRequest,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(require_role(UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Semantic search across topic outlines visible to the caller.

    Scope:
      - TEACHER → outlines for their own (DONE) sessions
      - ADMIN / SUPER_ADMIN → all DONE outlines
    """
    query_text = body.query.strip()
    if len(query_text) < 2:
        raise HTTPException(status_code=422, detail="Query must contain at least 2 characters")

    base_scope = (
        select(Session.id)
        .join(Chapter, Chapter.id == Session.chapter_id)
        .join(Course, Course.id == Chapter.course_id)
        .where(Session.status == SessionStatus.DONE)
    )
    if user.role == UserRole.TEACHER:
        base_scope = base_scope.where(Session.teacher_id == user.id)
    if body.teacher_id is not None:
        base_scope = base_scope.where(Session.teacher_id == body.teacher_id)
    if body.course_id is not None:
        base_scope = base_scope.where(Chapter.course_id == body.course_id)
    if body.level_id is not None:
        base_scope = base_scope.where(Course.level_id == body.level_id)
    if body.matiere_id is not None:
        base_scope = base_scope.where(Course.matiere_id == body.matiere_id)
    if body.language:
        base_scope = base_scope.where(
            func.lower(Session.dominant_language) == body.language.lower()
        )

    sess_result = await db.execute(base_scope)
    session_ids = [row[0] for row in sess_result.all()]
    if not session_ids:
        return {"total": 0, "offset": body.offset, "limit": body.limit, "results": []}

    total_result = await db.execute(
        select(func.count(Summary.session_id)).where(
            Summary.session_id.in_(session_ids),
            Summary.embedding.is_not(None),
        )
    )
    total = int(total_result.scalar() or 0)
    if total == 0:
        return {"total": 0, "offset": body.offset, "limit": body.limit, "results": []}

    try:
        query_vec = await get_or_embed(query_text)
    except EmbeddingUnavailable as e:
        log.error("search.embedding_unavailable", error=str(e)[:200])
        raise HTTPException(
            status_code=503,
            detail="Search temporarily unavailable. Please retry in a moment.",
        ) from e

    vec_str = "[" + ",".join(str(x) for x in query_vec) + "]"
    q_like = f"%{_escape_like(query_text.lower())}%"
    semantic_results = await db.execute(
        text(
            """
            WITH ranked AS (
                SELECT s.session_id,
                       1 - (s.embedding <=> CAST(:vec AS vector)) AS semantic_score,
                       CASE
                           WHEN LOWER(CAST(s.content AS TEXT)) LIKE :q_like ESCAPE '\'
                           THEN 1
                           ELSE 0
                       END AS lexical_hit
                FROM summaries s
                WHERE s.session_id = ANY(:ids) AND s.embedding IS NOT NULL
            )
            SELECT session_id,
                   semantic_score,
                   lexical_hit,
                   semantic_score + (lexical_hit * :lexical_boost) AS hybrid_score
            FROM ranked
            ORDER BY hybrid_score DESC, semantic_score DESC
            LIMIT :limit OFFSET :offset
            """
        ),
        {
            "vec": vec_str,
            "ids": session_ids,
            "q_like": q_like,
            "lexical_boost": LEXICAL_BOOST,
            "limit": body.limit,
            "offset": body.offset,
        },
    )

    rows = semantic_results.fetchall()
    if not rows:
        return {"total": total, "offset": body.offset, "limit": body.limit, "results": []}

    result_session_ids = [row[0] for row in rows]
    semantic_scores = {row[0]: float(row[1]) for row in rows}
    lexical_hits = {row[0]: bool(row[2]) for row in rows}
    hybrid_scores = {row[0]: float(row[3]) for row in rows}

    enriched = await db.execute(
        select(Session, Summary, Chapter, Course, User, Level, Matiere)
        .join(Summary, Summary.session_id == Session.id)
        .join(Chapter, Chapter.id == Session.chapter_id)
        .join(Course, Course.id == Chapter.course_id)
        .join(User, User.id == Session.teacher_id)
        .join(Level, Level.id == Course.level_id)
        .join(Matiere, Matiere.id == Course.matiere_id)
        .where(Session.id.in_(result_session_ids))
    )

    enriched_map = {
        sess.id: (sess, summary, level, matiere, teacher)
        for sess, summary, _chapter, _course, teacher, level, matiere in enriched.all()
    }

    results = []
    for sid in result_session_ids:
        if sid not in enriched_map:
            continue

        sess, summary, level, matiere, teacher = enriched_map[sid]
        content = summary.content if isinstance(summary.content, dict) else {}
        topics = content.get("topics", []) if isinstance(content, dict) else []
        snippet = _pick_topic_snippet(query_text, topics if isinstance(topics, list) else [])
        context_score = _parse_optional_float(content.get("context_score"))

        recorded_at = content.get("recorded_at")
        if not recorded_at:
            dt = sess.started_at or sess.created_at
            if isinstance(dt, datetime):
                recorded_at = dt.isoformat()

        results.append(
            {
                "session_id": str(sid),
                "session_title": sess.title,
                "course_title": content.get("course_title") or f"{matiere.name} - {level.name}",
                "teacher_name": content.get("teacher_name") or teacher.full_name or teacher.email,
                "level": level.name,
                "matiere": matiere.name,
                "language": content.get("language") or sess.dominant_language,
                "recorded_at": recorded_at,
                "context_score": round(context_score, 4) if context_score is not None else None,
                "score": round(semantic_scores[sid], 4),
                "hybrid_score": round(hybrid_scores[sid], 4),
                "lexical_hit": lexical_hits[sid],
                "snippet": snippet,
            }
        )

    return {"total": total, "offset": body.offset, "limit": body.limit, "results": results}
