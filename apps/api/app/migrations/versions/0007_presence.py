"""presence — who is looking at what, right now (the one ephemeral table)

Not a synced table, and this is the one place where that is enforced by physics rather than by
remembering: the PowerSync publication is `CREATE PUBLICATION powersync FOR ALL TABLES`, so
every new table is published automatically. An UNLOGGED table writes no WAL, logical decoding
therefore sees nothing, and presence *cannot* reach a device even if someone later adds it to
sync-rules.yaml by mistake. It is also free of WAL cost for a row rewritten every few seconds,
and losing the table to a crash is correct: everyone reappears on their next heartbeat.

Consequently `presence` is absent from sync-rules.yaml, from the client schema, and from
`TABLE_MODELS` in app/routers/sync.py. It is written over a plain REST endpoint instead
(app/routers/presence.py), so the four-place rule for synced tables does not apply here.

The natural key is (workspace, what you are looking at, who you are) — no surrogate id and no
timestamps mixin, because the "client-generated UUID + updated_at" invariant governs synced
rows and none of it is meaningful for a row that lives for seconds.

Revision ID: 0007_presence
Revises: 0006_comments
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0007_presence"
down_revision: str | None = "0006_comments"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "presence",
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        # "page:<uuid>" / "item:<uuid>" — deliberately a string, not a typed FK: presence must
        # not care what kinds of thing exist, and a row pointing at a deleted page is harmless.
        sa.Column("scope", sa.String(length=64), nullable=False),
        sa.Column("user_id", sa.String(length=64), nullable=False),
        # NOT NULL matters more than usual here: the expiry sweep is `seen_at < cutoff`, and a
        # NULL would never compare true — the row would be immortal AND permanently reported as
        # a viewer.
        sa.Column(
            "seen_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("workspace_id", "scope", "user_id"),
        prefixes=["UNLOGGED"],
    )
    op.create_index("ix_presence_seen_at", "presence", ["seen_at"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_presence_seen_at", table_name="presence")
    op.drop_table("presence")
