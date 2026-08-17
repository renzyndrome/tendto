"""add workspace_invitations (pending invites to share a workspace)

NOTE on the three-place rule (see .claude/skills/db-migration): this table is intentionally
NOT synced — it holds other people's email addresses and a bearer token, which have no place
on every member's device. So there is deliberately no matching entry in
infra/powersync/sync-rules.yaml or apps/web/src/lib/powersync/schema.ts; the settings panel
reads it over the API instead.

Revision ID: 0003_workspace_invitations
Revises: 0002_collection_config
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0003_workspace_invitations"
down_revision: str | None = "0002_collection_config"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "workspace_invitations",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("email", sa.String(length=320), nullable=False),
        sa.Column("role", sa.String(length=16), nullable=False),
        sa.Column("token", sa.String(length=64), nullable=False),
        sa.Column("invited_by", sa.String(length=64), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        # Deleting a workspace must take its pending invites with it, or a revoked-by-deletion
        # invite link would outlive the tenant it points at.
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token"),
        # One live invite per address per workspace; re-inviting refreshes the row.
        sa.UniqueConstraint("workspace_id", "email", name="uq_workspace_invitation_email"),
    )
    op.create_index(
        "ix_workspace_invitations_email", "workspace_invitations", ["email"], unique=False
    )
    op.create_index(
        "ix_workspace_invitations_workspace",
        "workspace_invitations",
        ["workspace_id"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("ix_workspace_invitations_workspace", table_name="workspace_invitations")
    op.drop_index("ix_workspace_invitations_email", table_name="workspace_invitations")
    op.drop_table("workspace_invitations")
