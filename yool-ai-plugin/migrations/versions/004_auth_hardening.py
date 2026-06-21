"""Migration 004 — Full auth hardening.

Changes:
- users: add is_verified (BOOLEAN, default FALSE)
- refresh_tokens: add user_agent, ip_address, last_used_at (device tracking)
- password_reset_tokens: new table (one-time reset tokens, hashed)
- email_verification_tokens: new table (email verification tokens, hashed)
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── users: email verification flag ─────────────────────────────────────
    op.add_column(
        "users",
        sa.Column("is_verified", sa.Boolean(), nullable=False, server_default="false"),
    )

    # ── refresh_tokens: device tracking ────────────────────────────────────
    op.add_column("refresh_tokens", sa.Column("user_agent",   sa.String(500), nullable=True))
    op.add_column("refresh_tokens", sa.Column("ip_address",   sa.String(45),  nullable=True))
    op.add_column("refresh_tokens", sa.Column("last_used_at", sa.DateTime(timezone=True), nullable=True))

    # ── password_reset_tokens ───────────────────────────────────────────────
    op.create_table(
        "password_reset_tokens",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash",          sa.String(64), nullable=False, unique=True),
        sa.Column("requested_from_ip",   sa.String(45), nullable=True),
        sa.Column("used_at",             sa.DateTime(timezone=True), nullable=True),
        sa.Column("expires_at",          sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_prt_user_id",    "password_reset_tokens", ["user_id"])
    op.create_index("ix_prt_token_hash", "password_reset_tokens", ["token_hash"])

    # ── email_verification_tokens ───────────────────────────────────────────
    op.create_table(
        "email_verification_tokens",
        sa.Column("id",         postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "user_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_evt_user_id",    "email_verification_tokens", ["user_id"])
    op.create_index("ix_evt_token_hash", "email_verification_tokens", ["token_hash"])


def downgrade() -> None:
    op.drop_index("ix_evt_token_hash", table_name="email_verification_tokens")
    op.drop_index("ix_evt_user_id",    table_name="email_verification_tokens")
    op.drop_table("email_verification_tokens")

    op.drop_index("ix_prt_token_hash", table_name="password_reset_tokens")
    op.drop_index("ix_prt_user_id",    table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")

    op.drop_column("refresh_tokens", "last_used_at")
    op.drop_column("refresh_tokens", "ip_address")
    op.drop_column("refresh_tokens", "user_agent")

    op.drop_column("users", "is_verified")
