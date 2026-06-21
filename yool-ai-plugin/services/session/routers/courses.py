"""Courses router — admin-managed courses, with assignment of a single teacher.

Enterprise pivot:
- Only admins / super_admins can create, update, or delete courses.
- Each course has a `teacher_id` set by the admin (assignment, not ownership).
- `PATCH /{course_id}/teacher` reassigns the course to a different teacher.
- Teachers only see (and operate on) the courses they are assigned to.
- Students no longer exist; enrollment endpoints are removed.
"""

import uuid
from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import get_current_user, require_role
from core.rate_limit import check_course_create_rate_limit
from core.utils import write_audit_log as _audit
from shared.database import get_session
from shared.models import Course, Level, Matiere, Session, User, UserRole

log = structlog.get_logger()
router = APIRouter(redirect_slashes=False)


# ── Schemas ───────────────────────────────────────────────────────────────────

class CourseCreate(BaseModel):
    level_id: uuid.UUID
    matiere_id: uuid.UUID
    teacher_id: uuid.UUID
    official_language: str = Field(default="fr", min_length=2, max_length=10)


class CoursePatch(BaseModel):
    level_id: uuid.UUID | None = None
    matiere_id: uuid.UUID | None = None
    official_language: str | None = Field(default=None, min_length=2, max_length=10)


class CourseTeacherAssignment(BaseModel):
    teacher_id: uuid.UUID


class _HierarchyItem(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str

class CourseOut(BaseModel):
    model_config = {"from_attributes": True}
    id:             uuid.UUID
    level_id:       uuid.UUID
    matiere_id:     uuid.UUID
    level:          _HierarchyItem | None = None
    matiere:        _HierarchyItem | None = None
    teacher_id:     uuid.UUID
    official_language: str
    created_at:     datetime
    session_count:  int = 0


class CourseListPage(BaseModel):
    items: list[CourseOut]
    total: int
    limit: int
    offset: int
    has_more: bool


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_course_or_404(course_id: uuid.UUID, db: AsyncSession) -> Course:
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


def _assert_course_access(course: Course, user: User) -> None:
    """Raises 403 if a non-admin teacher tries to access a course not assigned to them."""
    if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        return
    if course.teacher_id != user.id:
        raise HTTPException(status_code=403, detail="Course not assigned to you")


async def _session_counts_by_course(
    db: AsyncSession, course_ids: list[uuid.UUID]
) -> dict[uuid.UUID, int]:
    from shared.models import Chapter
    if not course_ids:
        return {}
    result = await db.execute(
        select(Chapter.course_id, func.count(Session.id))
        .select_from(Chapter)
        .join(Session, Session.chapter_id == Chapter.id)
        .where(Chapter.course_id.in_(course_ids))
        .group_by(Chapter.course_id)
    )
    return {row[0]: int(row[1]) for row in result.all()}


def _course_out(course: Course, session_count: int = 0) -> CourseOut:
    return CourseOut(
        id=course.id,
        level_id=course.level_id,
        matiere_id=course.matiere_id,
        level={"id": course.level.id, "name": course.level.name} if getattr(course, "level", None) else None,
        matiere={"id": course.matiere.id, "name": course.matiere.name} if getattr(course, "matiere", None) else None,
        official_language=course.official_language,
        teacher_id=course.teacher_id,
        created_at=course.created_at,
        session_count=session_count,
    )


def _course_list_filters(user: User, assigned_to_me: bool) -> list:
    clauses = []
    if user.role == UserRole.TEACHER:
        clauses.append(Course.teacher_id == user.id)
    elif assigned_to_me:
        clauses.append(Course.teacher_id == user.id)
    return clauses


async def _validate_teacher_assignment(teacher_id: uuid.UUID, db: AsyncSession) -> User:
    """
    Look up the prospective teacher and confirm they are an active, non-deleted
    user with role TEACHER.  Returns the User row for use by the caller.
    """
    teacher = await db.get(User, teacher_id)
    if not teacher or teacher.is_deleted or not teacher.is_active:
        raise HTTPException(404, "Teacher not found")
    if teacher.role != UserRole.TEACHER:
        raise HTTPException(422, "Assigned user must have the teacher role")
    return teacher


# ── Course CRUD ───────────────────────────────────────────────────────────────

@router.post("/", response_model=CourseOut, status_code=status.HTTP_201_CREATED)
async def create_course(
    body: CourseCreate,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: create a course and assign it to a teacher."""
    await _validate_teacher_assignment(body.teacher_id, db)
    await check_course_create_rate_limit(request)
    
    level = await db.get(Level, body.level_id)
    if not level:
        raise HTTPException(404, "Level not found")
        
    matiere = await db.get(Matiere, body.matiere_id)
    if not matiere:
        raise HTTPException(404, "Matiere not found")

    course = Course(
        id=uuid.uuid4(),
        level_id=body.level_id,
        matiere_id=body.matiere_id,
        official_language=body.official_language,
        teacher_id=body.teacher_id,
    )
    db.add(course)
    await db.flush()
    _audit(db, admin.id, "course.created", "course", str(course.id), request)
    await db.commit()
    # To return level/matiere nested objects, refresh and load them:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Course).options(selectinload(Course.level), selectinload(Course.matiere)).where(Course.id == course.id)
    )
    course = result.scalar_one()
    return _course_out(course, session_count=0)
    log.info(
        "course.created",
        course_id=str(course.id),
        teacher_id=str(body.teacher_id),
        by=str(admin.id),
    )
    return _course_out(course, 0)


@router.get("/", response_model=CourseListPage)
async def list_courses(
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
    assigned_to_me: bool = Query(default=False, description="Teachers: filter to only own courses"),
    search:     str | None = Query(default=None, max_length=120, description="Matches level or matiere name"),
    level_id:   uuid.UUID | None = Query(default=None),
    matiere_id: uuid.UUID | None = Query(default=None),
    teacher_id: uuid.UUID | None = Query(default=None, description="Admin only: courses assigned to this teacher"),
    language:   str | None = Query(default=None, pattern="^(fr|ar|en)$"),
    limit:  int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0,  ge=0),
):
    """
    Paginated course list.

    Visibility:
    - SUPER_ADMIN / ADMIN  → all courses by default; honors assigned_to_me only if their own id matches
    - TEACHER              → only their assigned courses (always filtered, regardless of flag)

    Optional filters:
    - search      → case-insensitive substring of the level or matiere name
    - level_id    → exact level match
    - matiere_id  → exact matiere match
    - teacher_id  → admin only; restrict to courses assigned to a specific teacher
    - language    → fr / ar / en
    """
    from sqlalchemy.orm import selectinload

    filters = _course_list_filters(user, assigned_to_me)

    if level_id is not None:
        filters.append(Course.level_id == level_id)
    if matiere_id is not None:
        filters.append(Course.matiere_id == matiere_id)
    if teacher_id is not None:
        # Only admins can query someone else's courses; teachers are already
        # restricted to their own by _course_list_filters above.
        if user.role in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
            filters.append(Course.teacher_id == teacher_id)
        # For teachers, ignore the param (they only ever see their own anyway).
    if language:
        filters.append(Course.official_language == language)

    if search:
        q = f"%{search.strip()}%"
        filters.append(
            Course.level.has(Level.name.ilike(q))
            | Course.matiere.has(Matiere.name.ilike(q))
        )

    count_q = select(func.count(Course.id))
    for clause in filters:
        count_q = count_q.where(clause)
    total = int((await db.execute(count_q)).scalar() or 0)

    items_q = select(Course).options(selectinload(Course.level), selectinload(Course.matiere))
    for clause in filters:
        items_q = items_q.where(clause)
    items_q = items_q.order_by(Course.created_at.desc()).limit(limit).offset(offset)
    result = await db.execute(items_q)
    courses = list(result.scalars().all())
    counts = await _session_counts_by_course(db, [c.id for c in courses])
    items = [_course_out(c, counts.get(c.id, 0)) for c in courses]

    return CourseListPage(
        items=items,
        total=total,
        limit=limit,
        offset=offset,
        has_more=offset + len(items) < total,
    )


async def _get_course_with_hierarchy_or_404(course_id: uuid.UUID, db: AsyncSession) -> Course:
    from sqlalchemy.orm import selectinload
    result = await db.execute(
        select(Course)
        .options(selectinload(Course.level), selectinload(Course.matiere))
        .where(Course.id == course_id)
    )
    course = result.scalar_one_or_none()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return course


@router.get("/{course_id}", response_model=CourseOut)
async def get_course(
    course_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    course = await _get_course_with_hierarchy_or_404(course_id, db)
    _assert_course_access(course, user)
    counts = await _session_counts_by_course(db, [course.id])
    return _course_out(course, counts.get(course.id, 0))


@router.patch("/{course_id}", response_model=CourseOut)
async def update_course(
    course_id: uuid.UUID,
    body: CoursePatch,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: update a course's hierarchy or language."""
    from shared.models import Level, Matiere
    course = await _get_course_with_hierarchy_or_404(course_id, db)

    if body.level_id is not None:
        level = await db.get(Level, body.level_id)
        if not level:
            raise HTTPException(404, "Level not found")
        course.level_id = body.level_id
        
    if body.matiere_id is not None:
        matiere = await db.get(Matiere, body.matiere_id)
        if not matiere:
            raise HTTPException(404, "Matiere not found")
        course.matiere_id = body.matiere_id
        
    if body.official_language is not None:
        course.official_language = body.official_language

    _audit(db, admin.id, "course.updated", "course", str(course_id), request)
    log.info("course.updated", course_id=str(course_id), by=str(admin.id))
    await db.commit()
    await db.refresh(course, ["level", "matiere"])
    counts = await _session_counts_by_course(db, [course.id])
    return _course_out(course, counts.get(course.id, 0))


@router.patch("/{course_id}/teacher", response_model=CourseOut)
async def reassign_teacher(
    course_id: uuid.UUID,
    body: CourseTeacherAssignment,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: reassign a course to a different teacher."""
    course = await _get_course_or_404(course_id, db)
    await _validate_teacher_assignment(body.teacher_id, db)

    old_teacher_id = course.teacher_id
    course.teacher_id = body.teacher_id

    _audit(db, admin.id, "course.teacher_reassigned", "course", str(course_id), request)
    log.info(
        "course.teacher_reassigned",
        course_id=str(course_id),
        old_teacher_id=str(old_teacher_id),
        new_teacher_id=str(body.teacher_id),
        by=str(admin.id),
    )
    counts = await _session_counts_by_course(db, [course.id])
    return _course_out(course, counts.get(course.id, 0))


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_course(
    course_id: uuid.UUID,
    request: Request,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """
    Admin-only hard delete. Cascades to sessions, transcripts, and topic outlines.
    """
    course = await _get_course_or_404(course_id, db)
    await db.delete(course)
    _audit(db, admin.id, "course.deleted", "course", str(course_id), request)
    log.info("course.deleted", course_id=str(course_id), by=str(admin.id))
