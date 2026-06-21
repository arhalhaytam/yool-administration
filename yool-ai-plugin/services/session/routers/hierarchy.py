"""Hierarchy router — admin-managed Levels and Matieres.

These are the global lookup tables for courses.
"""

import uuid
from typing import Annotated

import structlog
from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy import delete as sql_delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from core.dependencies import require_role
from shared.database import get_session
from shared.models import Course, Level, Matiere, User, UserRole

log = structlog.get_logger()
router = APIRouter(redirect_slashes=False)


# ── Schemas ───────────────────────────────────────────────────────────────────

class LevelCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100, strip_whitespace=True)

class LevelPatch(BaseModel):
    name: str = Field(min_length=2, max_length=100, strip_whitespace=True)

class LevelOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str

class MatiereCreate(BaseModel):
    name: str = Field(min_length=2, max_length=100, strip_whitespace=True)

class MatierePatch(BaseModel):
    name: str = Field(min_length=2, max_length=100, strip_whitespace=True)

class MatiereOut(BaseModel):
    model_config = {"from_attributes": True}
    id: uuid.UUID
    name: str


# ── Levels ────────────────────────────────────────────────────────────────────

@router.get("/levels", response_model=list[LevelOut])
async def list_levels(db: Annotated[AsyncSession, Depends(get_session)]):
    """List all available levels."""
    result = await db.execute(select(Level).order_by(Level.name))
    return result.scalars().all()


@router.post("/levels", response_model=LevelOut, status_code=status.HTTP_201_CREATED)
async def create_level(
    body: LevelCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: create a new level."""
    level = Level(id=uuid.uuid4(), name=body.name)
    db.add(level)
    await db.commit()
    await db.refresh(level)
    return level


@router.patch("/levels/{level_id}", response_model=LevelOut)
async def rename_level(
    level_id: uuid.UUID,
    body: LevelPatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: rename an existing level."""
    level = await db.get(Level, level_id)
    if not level:
        raise HTTPException(404, "Level not found")
    level.name = body.name
    await db.commit()
    await db.refresh(level)
    return level


@router.delete("/levels/{level_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_level(
    level_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: delete a level. Rejected if any course references it."""
    level = await db.get(Level, level_id)
    if not level:
        raise HTTPException(404, "Level not found")
    in_use = await db.scalar(
        select(func.count(Course.id)).where(Course.level_id == level_id)
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Level is used by {in_use} course(s) and cannot be deleted",
        )
    await db.execute(sql_delete(Level).where(Level.id == level_id))
    await db.commit()


# ── Matieres ──────────────────────────────────────────────────────────────────

@router.get("/matieres", response_model=list[MatiereOut])
async def list_matieres(db: Annotated[AsyncSession, Depends(get_session)]):
    """List all available matieres."""
    result = await db.execute(select(Matiere).order_by(Matiere.name))
    return result.scalars().all()


@router.post("/matieres", response_model=MatiereOut, status_code=status.HTTP_201_CREATED)
async def create_matiere(
    body: MatiereCreate,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: create a new matiere."""
    matiere = Matiere(id=uuid.uuid4(), name=body.name)
    db.add(matiere)
    await db.commit()
    await db.refresh(matiere)
    return matiere


@router.patch("/matieres/{matiere_id}", response_model=MatiereOut)
async def rename_matiere(
    matiere_id: uuid.UUID,
    body: MatierePatch,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: rename an existing matiere."""
    matiere = await db.get(Matiere, matiere_id)
    if not matiere:
        raise HTTPException(404, "Matiere not found")
    matiere.name = body.name
    await db.commit()
    await db.refresh(matiere)
    return matiere


@router.delete("/matieres/{matiere_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_matiere(
    matiere_id: uuid.UUID,
    db: Annotated[AsyncSession, Depends(get_session)],
    admin: Annotated[User, Depends(require_role(UserRole.ADMIN, UserRole.SUPER_ADMIN))],
):
    """Admin-only: delete a matiere. Rejected if any course references it."""
    matiere = await db.get(Matiere, matiere_id)
    if not matiere:
        raise HTTPException(404, "Matiere not found")
    in_use = await db.scalar(
        select(func.count(Course.id)).where(Course.matiere_id == matiere_id)
    )
    if in_use:
        raise HTTPException(
            status.HTTP_409_CONFLICT,
            f"Matiere is used by {in_use} course(s) and cannot be deleted",
        )
    await db.execute(sql_delete(Matiere).where(Matiere.id == matiere_id))
    await db.commit()
