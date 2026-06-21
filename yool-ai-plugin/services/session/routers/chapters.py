"""Chapters router — managing syllabus chapters within a course.

Admins and the assigned Teacher can create chapters.
"""

import uuid
from datetime import datetime
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from core.dependencies import get_current_user
from shared.database import get_session
from shared.models import Chapter, Course, User, UserRole

log = structlog.get_logger()
router = APIRouter(redirect_slashes=False)


# ── Schemas ───────────────────────────────────────────────────────────────────

class ChapterCreate(BaseModel):
    course_id: uuid.UUID
    title: str = Field(min_length=2, max_length=255, strip_whitespace=True)
    order_index: int = 0


class ChapterUpdate(BaseModel):
    title: str | None = Field(default=None, min_length=2, max_length=255, strip_whitespace=True)
    order_index: int | None = None


class ChapterOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    course_id: uuid.UUID
    title: str
    order_index: int
    created_at: datetime


# ── Helpers ───────────────────────────────────────────────────────────────────

async def _get_course_for_chapter(course_id: uuid.UUID, user: User, db: AsyncSession) -> Course:
    course = await db.get(Course, course_id)
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    
    if user.role not in (UserRole.ADMIN, UserRole.SUPER_ADMIN):
        if course.teacher_id != user.id:
            raise HTTPException(status_code=403, detail="Not assigned to this course")
            
    return course


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/", response_model=list[ChapterOut])
async def list_chapters(
    course_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """List all chapters for a specific course."""
    await _get_course_for_chapter(course_id, user, db)

    result = await db.execute(
        select(Chapter)
        .where(Chapter.course_id == course_id)
        .order_by(Chapter.order_index, Chapter.created_at)
    )
    return result.scalars().all()


@router.post("/", response_model=ChapterOut, status_code=status.HTTP_201_CREATED)
async def create_chapter(
    body: ChapterCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Create a new chapter inside a course."""
    await _get_course_for_chapter(body.course_id, user, db)

    chapter = Chapter(
        id=uuid.uuid4(),
        course_id=body.course_id,
        title=body.title,
        order_index=body.order_index,
    )
    db.add(chapter)
    await db.commit()
    await db.refresh(chapter)
    return chapter


@router.patch("/{chapter_id}", response_model=ChapterOut)
async def update_chapter(
    chapter_id: uuid.UUID,
    body: ChapterUpdate,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Update a chapter's title or order_index."""
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    
    await _get_course_for_chapter(chapter.course_id, user, db)

    if body.title is not None:
        chapter.title = body.title
    if body.order_index is not None:
        chapter.order_index = body.order_index

    await db.commit()
    await db.refresh(chapter)
    return chapter


@router.delete("/{chapter_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_chapter(
    chapter_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    user: Annotated[User, Depends(get_current_user)],
):
    """Delete a chapter."""
    chapter = await db.get(Chapter, chapter_id)
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    
    await _get_course_for_chapter(chapter.course_id, user, db)

    await db.delete(chapter)
    await db.commit()
