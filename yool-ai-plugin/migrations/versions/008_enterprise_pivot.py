"""Migration 008 — Enterprise pivot: drop students, drop class-link invites,
drop live partial summaries, drop per-session consent fields.

Background
----------
The platform pivoted from a student-facing study tool to an enterprise audit
tool that produces a chronological topic outline of what teachers covered in
their lectures. As a consequence the schema sheds three big things:

    1. enrollments         — students no longer exist in the product.
    2. course_invites      — teacher-issued class links also disappear.
    3. partial_summaries   — there is no live mid-lecture catch-up feed.

Per-session GDPR consent fields (`consent_confirmed`, `consent_version`,
`consent_at`) on the `sessions` table are removed too — consent is now
recorded once at the institutional level, never per recording.

Existing student rows in `users` are not hard-deleted (they may be referenced
by audit logs); they are anonymized and soft-deleted in place.

Notes
-----
- We deliberately KEEP the `summaries` table and the `student` enum value on
  `user_role`. The summaries table now stores a topic-outline JSON shape;
  the schema doesn't change. The `student` enum value is preserved for the
  audit-log history; it is blocked at the application schema layer.
- `speaker_role` Postgres enum: renames value `student` → `participant`
  (SQLAlchemy still uses `native_enum=False` for asyncpg, but the DB type
  from migration 001 remains a real enum).
- All drops are idempotent (`IF EXISTS`) so a partially-applied migration
  can be retried safely.
- Downgrade reconstructs the dropped tables and columns. It is best-effort:
  data dropped on upgrade is not magically resurrected.
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID


revision = "008"
down_revision = "007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # 1) Anonymize and soft-delete any pre-existing student users so existing
    #    audit-log foreign keys remain valid while removing PII.
    op.execute("""
        UPDATE users
        SET email         = 'deleted_legacy_student_' || substr(id::text, 1, 8) || '@anonymized.invalid',
            full_name     = 'Deleted Student (legacy)',
            password_hash = 'DELETED',
            is_active     = false,
            is_deleted    = true,
            deleted_at    = COALESCE(deleted_at, now())
        WHERE role = 'student' AND is_deleted = false
    """)

    # 2) Drop the student-only tables.
    #    Order matters: course_invites and enrollments both reference courses/users,
    #    partial_summaries references sessions. None of them are referenced BY any
    #    surviving table, so DROP TABLE IF EXISTS is safe.
    op.execute("DROP INDEX IF EXISTS ix_course_invites_token_hash")
    op.execute("DROP INDEX IF EXISTS ix_course_invites_course_id")
    op.execute("DROP TABLE IF EXISTS course_invites CASCADE")

    op.execute("DROP INDEX IF EXISTS ix_partial_summaries_session_id")
    op.execute("DROP TABLE IF EXISTS partial_summaries CASCADE")

    op.execute("DROP TABLE IF EXISTS enrollments CASCADE")

    # 3) Drop per-session consent columns. They were nullable and have no FK
    #    dependents, so this is a metadata-only change (cheap).
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS consent_confirmed")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS consent_version")
    op.execute("ALTER TABLE sessions DROP COLUMN IF EXISTS consent_at")

    # 4) Diarization: non-teacher voices are participants, not students.
    op.execute("""
DO $speaker_role_rename$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'speaker_role' AND e.enumlabel = 'student'
    ) THEN
        ALTER TYPE speaker_role RENAME VALUE 'student' TO 'participant';
    END IF;
END
$speaker_role_rename$;
""")


def downgrade() -> None:
    """Recreate the dropped tables + columns. Data is NOT restored."""

    op.execute("""
DO $speaker_role_rename$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM pg_enum e
        JOIN pg_type t ON e.enumtypid = t.oid
        WHERE t.typname = 'speaker_role' AND e.enumlabel = 'participant'
    ) THEN
        ALTER TYPE speaker_role RENAME VALUE 'participant' TO 'student';
    END IF;
END
$speaker_role_rename$;
""")

    # ── Per-session consent fields ────────────────────────────────────────
    op.add_column(
        "sessions",
        sa.Column("consent_confirmed", sa.Boolean(), nullable=False, server_default="false"),
    )
    op.add_column(
        "sessions",
        sa.Column("consent_version", sa.String(20), nullable=True),
    )
    op.add_column(
        "sessions",
        sa.Column("consent_at", sa.DateTime(timezone=True), nullable=True),
    )

    # ── enrollments ──────────────────────────────────────────────────────
    op.create_table(
        "enrollments",
        sa.Column(
            "student_id",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "course_id",
            UUID(as_uuid=True),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            primary_key=True,
        ),
        sa.Column(
            "enrolled_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.UniqueConstraint("student_id", "course_id", name="uq_enrollment"),
    )

    # ── course_invites ───────────────────────────────────────────────────
    op.create_table(
        "course_invites",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("token_hash", sa.String(64), nullable=False, unique=True),
        sa.Column(
            "course_id",
            UUID(as_uuid=True),
            sa.ForeignKey("courses.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "created_by",
            UUID(as_uuid=True),
            sa.ForeignKey("users.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("max_uses",   sa.Integer(), nullable=True),
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

    # ── partial_summaries ────────────────────────────────────────────────
    op.create_table(
        "partial_summaries",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "session_id",
            UUID(as_uuid=True),
            sa.ForeignKey("sessions.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("content", JSONB, nullable=False),
        sa.Column(
            "generated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_index("ix_partial_summaries_session_id", "partial_summaries", ["session_id"])
