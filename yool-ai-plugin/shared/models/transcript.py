"""Transcript segment model — one row per speech segment."""

import enum
import uuid
from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class SpeakerRole(str, enum.Enum):
    TEACHER = "teacher"
    # Non-teacher voices in the room (questions, discussion) — not "student" in an enterprise product.
    PARTICIPANT = "participant"
    UNKNOWN = "unknown"


class Transcript(Base):
    __tablename__ = "transcripts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )

    speaker_role: Mapped[SpeakerRole] = mapped_column(
        Enum(
            SpeakerRole,
            name="speaker_role",
            values_callable=lambda x: [e.value for e in x],
            create_type=False,   # type is managed by Alembic migrations
            native_enum=False,   # prevents SQLAlchemy 2.x from binding enum .name instead of .value
        ),
        nullable=False,
        default=SpeakerRole.UNKNOWN,
    )
    # Raw diarization label (e.g. SPEAKER_00) — mapped to role above
    speaker_label: Mapped[str] = mapped_column(String(50), nullable=False)

    text: Mapped[str]     = mapped_column(Text, nullable=False)
    language: Mapped[str] = mapped_column(String(10), nullable=False, default="fr")

    # Timestamps within the audio (milliseconds from session start)
    segment_start_ms: Mapped[int] = mapped_column(Integer, nullable=False)
    segment_end_ms: Mapped[int]   = mapped_column(Integer, nullable=False)

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    session: Mapped["Session"] = relationship(back_populates="transcripts")  # noqa: F821

    def __repr__(self) -> str:
        return f"<Transcript [{self.speaker_role}] {self.text[:40]}>"
