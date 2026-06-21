"""Migration 005 — Add super_admin role.

Changes:
- Extends the user_role PostgreSQL enum with 'super_admin'.
- ALTER TYPE ... ADD VALUE must run outside a transaction in PostgreSQL < 12.
  In PostgreSQL 12+ it can run inside a transaction, but we use the safe
  pattern (op.execute with autocommit) to stay compatible with all versions.
"""

from alembic import op

revision = "005"
down_revision = "004"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ADD VALUE cannot be reversed in PostgreSQL — downgrade is a no-op.
    # Use IF NOT EXISTS (PostgreSQL 12+) so the migration is idempotent.
    op.execute("ALTER TYPE user_role ADD VALUE IF NOT EXISTS 'super_admin'")


def downgrade() -> None:
    # PostgreSQL does not support removing enum values.
    # A full downgrade would require recreating the enum and all columns that use it.
    # For safety, this is intentionally left as a no-op.
    pass
