"""Matiere model.

Represents an academic subject discipline (e.g., "Mathématiques").
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Matiere(Base):
    __tablename__ = "matieres"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    courses: Mapped[list["Course"]] = relationship(  # noqa: F821
        back_populates="matiere", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Matiere {self.name}>"
