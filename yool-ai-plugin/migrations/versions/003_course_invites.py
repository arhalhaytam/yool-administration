"""Migration 003 — Course class invite links.

Changes:
- course_invites: new table for teacher-issued reusable class links
  - token_hash  (SHA-256 of raw token, UNIQUE)
  - course_id   FK → courses (CASCADE)
  - created_by  FK → users  (CASCADE)
  - max_uses    INTEGER NULLABLE  (None = unlimited)
  - use_count   INTEGER NOT NULL DEFAULT 0
  - is_active   BOOLEAN NOT NULL DEFAULT TRUE
  - expires_at  TIMESTAMPTZ NOT NULL
  - created_at  TIMESTAMPTZ server_default
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "course_invites",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token_hash", sa.String(64),  nullable=False, unique=True),
        sa.Column(
            "course_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("max_uses",   sa.Integer(), nullable=True),          # None = unlimited
        sa.Column("use_count",  sa.Integer(), nullable=False, server_default="0"),
        sa.Column("is_active",  sa.Boolean(), nullable=False, server_default="true"),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_course_invites_course_id",  "course_invites", ["course_id"])
    op.create_index("ix_course_invites_token_hash", "course_invites", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_course_invites_token_hash", table_name="course_invites")
    op.drop_index("ix_course_invites_course_id",  table_name="course_invites")
    op.drop_table("course_invites")
