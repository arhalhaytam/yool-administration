"""Migration 009 — Add IVFFlat index on summaries.embedding for fast semantic search.

Without this index, every semantic search does a full sequential scan of the
summaries table and computes cosine distance for every row. With 500+ sessions
this degrades to seconds per query.

IVFFlat (Inverted File with Flat quantization) is the recommended pgvector
index type for datasets up to ~1M vectors. It divides the vector space into
`lists` clusters; queries scan only the nearest `probes` clusters.

Tuning guidance (adjust after you have more data):
    lists  = max(1, round(sqrt(row_count)))    → 20 for 400 rows, 100 for 10k
    probes = max(1, lists // 10)               → set at query time via SET ivfflat.probes

We start conservative (lists=20) which is correct for early production.
Rebuild the index with REINDEX when the dataset grows beyond ~10k rows.
"""

from alembic import op


revision = "009"
down_revision = "3dfa90b2f2ae"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ensure pgvector extension is active (idempotent)
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    # IVFFlat index for cosine-distance semantic search.
    # CONCURRENTLY avoids locking the table — safe to run on a live database.
    # Note: CONCURRENTLY cannot run inside an explicit transaction block; Alembic
    # runs each migration inside a transaction by default, so we use op.execute
    # with a raw CREATE INDEX (non-concurrent) here for simplicity.
    # Switch to CONCURRENTLY only if running manually outside Alembic.
    op.execute("""
        CREATE INDEX IF NOT EXISTS ix_summaries_embedding_ivfflat
        ON summaries
        USING ivfflat (embedding vector_cosine_ops)
        WITH (lists = 20)
    """)


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_summaries_embedding_ivfflat")
