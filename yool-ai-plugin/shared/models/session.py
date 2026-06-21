"""Session model — lifecycle of a teaching session.

The state machine is CREATED -> LIVE -> PROCESSING -> DONE, with a FAILED
terminal that any non-terminal state can transition into via /cancel. Stop
is always manual: the teacher calls POST /sessions/{id}/end to leave LIVE.

Per-session consent fields were removed in the enterprise pivot — consent is
now recorded once at the institutional level, not on every recording.
"""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class SessionStatus(str, enum.Enum):
    CREATED    = "created"
    LIVE       = "live"
    PROCESSING = "processing"
    DONE       = "done"
    FAILED     = "failed"


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    title: Mapped[str] = mapped_column(String(255), nullable=False)

    chapter_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("chapters.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    teacher_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    status: Mapped[SessionStatus] = mapped_column(
        Enum(
            SessionStatus,
            name="session_status",
            values_callable=lambda x: [e.value for e in x],
            create_type=False,
            native_enum=False,
        ),
        default=SessionStatus.CREATED,
        nullable=False,
    )

    dominant_language: Mapped[str | None] = mapped_column(String(10), nullable=True)

    started_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    ended_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    chapter: Mapped["Chapter"] = relationship(back_populates="sessions")  # noqa: F821
    transcripts: Mapped[list["Transcript"]] = relationship(  # noqa: F821
        back_populates="session", cascade="all, delete-orphan"
    )
    summary: Mapped["Summary | None"] = relationship(  # noqa: F821
        back_populates="session",
        uselist=False,
        cascade="all, delete-orphan",
    )

    @property
    def course_id(self) -> uuid.UUID:
        return self.chapter.course_id

    def __repr__(self) -> str:
        return f"<Session {self.title} [{self.status}]>"
