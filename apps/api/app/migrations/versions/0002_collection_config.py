"""add collections.config (per-collection view config, e.g. board columns)

Revision ID: 0002_collection_config
Revises: 0001_initial
Create Date: 2026-07-12

JSONB, NOT NULL default '{}'. Holds board status columns:
{"columns": [{"id": "todo", "label": "To do"}, ...]}. Empty ⇒ client uses the default three.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0002_collection_config"
down_revision: str | None = "0001_initial"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "collections",
        sa.Column(
            "config",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
            server_default="{}",
        ),
    )


def downgrade() -> None:
    op.drop_column("collections", "config")
