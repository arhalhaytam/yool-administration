"""Migration 007 — Case-insensitive email uniqueness index.

Why this migration?
-------------------
The `users.email` column has `UNIQUE` (case-sensitive) enforced by SQLAlchemy.
However, PostgreSQL's default equality is case-sensitive:
    'alice@gmail.com' != 'Alice@Gmail.com'

The application normalises all emails to lowercase on write (enforced by the
business logic layer), but a DB-level functional index on `lower(email)` is a
defence-in-depth measure that holds even if:
  - A migration script writes emails without normalisation
  - A future developer accidentally bypasses the `.lower()` call
  - Raw SQL is used to insert data during migrations or data fixes

The existing case-sensitive UNIQUE constraint is kept unchanged (it protects
against exact duplicates without the overhead of a function call). This
functional index adds an additional constraint at the storage level.

PostgreSQL supports UNIQUE indexes on expressions, which is exactly what we
need here.

Rollback: DROP INDEX is instant (no table lock, no data move).
"""

from alembic import op


revision = "007"
down_revision = "006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Functional UNIQUE index on lower(email)
    # IF NOT EXISTS is safe for idempotent re-runs (e.g. after a failed deploy)
    op.execute("""
        CREATE UNIQUE INDEX IF NOT EXISTS ix_users_email_ci
        ON users (lower(email))
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_email_ci")
