"""Course model.

Courses are created by admins and assigned to a teacher (`teacher_id`).
Teachers do not create their own courses in the enterprise pivot — they
only deliver lectures for the courses an admin has assigned to them.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class Course(Base):
    __tablename__ = "courses"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    level_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("levels.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    matiere_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("matieres.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )

    official_language: Mapped[str] = mapped_column(
        String(10), default="fr", nullable=False
    )

    # Assigned by an admin. The teacher who is responsible for delivering
    # lectures for this course. Reassignable via PATCH /courses/{id}/teacher.
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    teacher: Mapped["User"] = relationship(  # noqa: F821
        back_populates="courses_taught", foreign_keys=[teacher_id]
    )
    level: Mapped["Level"] = relationship(  # noqa: F821
        back_populates="courses", foreign_keys=[level_id]
    )
    matiere: Mapped["Matiere"] = relationship(  # noqa: F821
        back_populates="courses", foreign_keys=[matiere_id]
    )
    chapters: Mapped[list["Chapter"]] = relationship(  # noqa: F821
        back_populates="course", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<Course {self.id}>"
