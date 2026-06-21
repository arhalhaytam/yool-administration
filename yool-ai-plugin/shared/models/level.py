"""Level model.

Represents an academic grade or track (e.g., "1BAC - Sciences Maths").
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Level(Base):
    __tablename__ = "levels"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    name: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    courses: Mapped[list["Course"]] = relationship(  # noqa: F821
        back_populates="level", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Level {self.name}>"
