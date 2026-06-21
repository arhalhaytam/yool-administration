"""Migration 002 — Production security additions.

Changes:
- sessions: add consent_version (VARCHAR), consent_at (TIMESTAMPTZ)
- users: add deleted_at (TIMESTAMPTZ) for hard-delete auditing
"""

from alembic import op
import sqlalchemy as sa

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ── Consent versioning on sessions ─────────────────────────────────────
    # Records WHICH version of the privacy notice the teacher accepted,
    # and WHEN they accepted it — required for GDPR Article 7 compliance.
    op.add_column(
        "sessions",
        sa.Column("consent_version", sa.String(20), nullable=True),
    )
    op.add_column(
        "sessions",
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── Soft-delete audit trail on users ───────────────────────────────────
    # deleted_at records when a user exercised their right to erasure.
    # The row is kept for audit purposes but the user is anonymized.
    op.add_column(
        "users",
        sa.Column("deleted_at", sa.DateTime(timezone=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("users", "deleted_at")
    op.drop_column("sessions", "consent_at")
    op.drop_column("sessions", "consent_version")
