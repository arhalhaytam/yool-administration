"""Chapter model.

Represents a syllabus topic/module under a specific Course.
Sessions belong to Chapters, not directly to Courses.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Integer, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Chapter(Base):
    __tablename__ = "chapters"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    order_index: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    
    course_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("courses.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    course: Mapped["Course"] = relationship(  # noqa: F821
        back_populates="chapters", foreign_keys=[course_id]
    )
    sessions: Mapped[list["Session"]] = relationship(  # noqa: F821
        back_populates="chapter", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Chapter {self.title}>"
