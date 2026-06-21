"""Summary model — final topic outline produced by the AI after a lecture ends.

The `content` JSONB column stores a self-contained topic outline so a single
exported row is meaningful on its own without joining other tables:

    {
      "course_title":     "Algorithmes et Structures de Données",
      "teacher_name":     "Prof. Khaled Bennani",
      "session_title":    "Cours: Algorithmes — 30/04/2026 10:00",
      "session_id":       "uuid",
      "recorded_at":      "ISO 8601 timestamp",
      "duration_minutes": 75,
      "language":         "fr",
      "topics": [
        {
          "start_time":   "HH:MM:SS",
          "end_time":     "HH:MM:SS",
          "title":        "Short topic title (5-10 words)",
          "description":  "2-3 sentence description of what was actually said",
          "key_concepts": ["term 1", "term 2"]
        }
      ]
    }

The metadata fields (course_title, teacher_name, session_title, session_id,
recorded_at) are injected by the persistence layer in
`services/stt/pipeline/processor.py` from the DB to prevent LLM hallucination.
The AI only produces `language`, `topics[]`, and `duration_minutes`.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from pgvector.sqlalchemy import Vector

from .base import Base


class Summary(Base):
    """Final self-contained topic outline for a completed session. One per session."""

    __tablename__ = "summaries"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4
    )
    session_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("sessions.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
        index=True,
    )

    # Self-contained topic outline (see module docstring for full shape).
    content: Mapped[dict] = mapped_column(JSONB, nullable=False)

    # Embedding from Gemini text-embedding-004 (768 dimensions) — used by
    # the query service for semantic search across all stored topic outlines.
    embedding: Mapped[list[float]] = mapped_column(
        Vector(768), nullable=True
    )

    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    # Relationships
    session: Mapped["Session"] = relationship(  # noqa: F821
        back_populates="summary"
    )

    def __repr__(self) -> str:
        return f"<Summary for session {self.session_id}>"
