"""add invites (shareable workspace invitations, server-only)

Revision ID: 0003_invites
Revises: 0002_collection_config
Create Date: 2026-07-14

Server-only table (never synced): a token-redeemable invite that grants editor/viewer
membership in a workspace. See app/models/core.py::Invite and docs/planning/05.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "0003_invites"
down_revision: str | None = "0002_collection_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "invites",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "workspace_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("workspaces.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=True),
        sa.Column("created_by", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("accepted_by", sa.String(length=64), nullable=True),
        sa.Column("accepted_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.func.now(),
            nullable=False,
        ),
    )
    op.create_unique_constraint("uq_invites_token", "invites", ["token"])
    op.create_index("ix_invites_workspace", "invites", ["workspace_id"])


def downgrade() -> None:
    op.drop_index("ix_invites_workspace", table_name="invites")
    op.drop_constraint("uq_invites_token", "invites", type_="unique")
    op.drop_table("invites")
