"""Migration 006 — Teacher/Admin invite links.

Changes:
- teacher_invites: new table for email-locked, single-use onboarding links
  - token_hash  SHA-256, UNIQUE
  - email       VARCHAR(255) — pre-filled, invite is locked to this address
  - role        user_role enum — role granted on acceptance
  - created_by  FK users.id
  - expires_at  TIMESTAMPTZ
  - used_at     TIMESTAMPTZ NULLABLE — set on acceptance (single-use enforcement)
  - used_by     FK users.id NULLABLE — the created account
  - created_at  TIMESTAMPTZ server_default
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "006"
down_revision = "005"
branch_labels = None
depends_on = None

# Reference the existing user_role enum WITHOUT creating it.
# postgresql.ENUM with create_type=False always respects the flag (unlike sa.Enum).
existing_user_role = postgresql.ENUM(
    "super_admin", "admin", "teacher", "student",
    name="user_role",
    create_type=False,   # Already created by migration 001 + extended by 005
)


def upgrade() -> None:
    op.create_table(
        "teacher_invites",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("email",      sa.String(255), nullable=False),
        sa.Column("role",       existing_user_role, nullable=False, server_default="teacher"),
        sa.Column(
            "created_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at",    sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "used_by",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_ti_email",      "teacher_invites", ["email"])
    op.create_index("ix_ti_token_hash", "teacher_invites", ["token_hash"])
    op.create_index("ix_ti_created_by", "teacher_invites", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_ti_created_by", table_name="teacher_invites")
    op.drop_index("ix_ti_token_hash",  table_name="teacher_invites")
    op.drop_index("ix_ti_email",       table_name="teacher_invites")
    op.drop_table("teacher_invites")
