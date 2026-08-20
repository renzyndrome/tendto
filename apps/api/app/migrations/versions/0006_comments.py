"""comments — a flat comment stream on a page or a card, with inline @mentions

Workspace-scoped, so comments ride the existing `workspace_content` bucket: a comment is meant
to reach every member, unlike focus_sessions (0005). What is new here is a SECOND ownership
layer inside a workspace — the row's author. sync.py pins `author_id` to the token subject on
create and refuses edits from anyone else; the workspace owner may delete but never edit.

`page_id`/`item_id` are the same XOR ownership as `blocks` (0004), enforced by a CHECK because
both columns arrive from a client. `author_label` denormalizes the author's name-or-email at
write time: user records live in better-auth's own tables and never sync, so without it a
comment could not render on a device that has not fetched the roster.

`body` is TEXT holding inline `@[<user_id>:<label>]` tokens rather than JSONB, so JSON_COLUMNS in
sync.py is untouched. `authored_at` and `edited_at` ARE client-supplied timestamps, so both must
be listed in DATETIME_COLUMNS — asyncpg refuses to bind an ISO string to a timestamptz, and
because the upload queue is ordered that 500 would wedge the device's writes permanently.

Three-place rule (.claude/skills/db-migration) — these change together with this migration:
apps/api/app/models/core.py, infra/powersync/sync-rules.yaml,
apps/web/src/lib/powersync/schema.ts. Plus apps/api/app/routers/sync.py, where TABLE_MODELS is
the upload allowlist and AUTHOR_OWNED_TABLES is the new per-row authorization branch.

Revision ID: 0006_comments
Revises: 0005_focus_sessions
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0006_comments"
down_revision: str | None = "0005_focus_sessions"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "comments",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("workspace_id", sa.UUID(), nullable=False),
        sa.Column("page_id", sa.UUID(), nullable=True),
        sa.Column("item_id", sa.UUID(), nullable=True),
        # better-auth user id; no FK — better-auth owns `user` (see memberships.user_id).
        sa.Column("author_id", sa.String(length=64), nullable=False),
        # Cosmetic, client-supplied; identity rides author_id above.
        sa.Column("author_label", sa.String(length=320), nullable=False),
        # Plain text with inline @[<user_id>:<label>] mention tokens.
        sa.Column("body", sa.Text(), nullable=False),
        # When the DEVICE wrote it — what the thread sorts and dates by. `created_at` is stamped
        # by the server at upload time, so an offline comment would read "just now" days later.
        sa.Column("authored_at", sa.DateTime(timezone=True), nullable=False),
        # NULL until edited. Not derived from updated_at vs created_at: those come from two
        # different clocks (the client's and the server's), so their difference means nothing.
        sa.Column("edited_at", sa.DateTime(timezone=True), nullable=True),
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
        sa.ForeignKeyConstraint(["workspace_id"], ["workspaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["page_id"], ["pages.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["item_id"], ["items.id"], ondelete="CASCADE"),
        sa.CheckConstraint(
            "(page_id IS NOT NULL) <> (item_id IS NOT NULL)",
            name="ck_comments_exactly_one_owner",
        ),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_comments_workspace", "comments", ["workspace_id"], unique=False)
    op.create_index("ix_comments_page", "comments", ["page_id"], unique=False)
    op.create_index("ix_comments_item", "comments", ["item_id"], unique=False)


def downgrade() -> None:
    op.drop_index("ix_comments_item", table_name="comments")
    op.drop_index("ix_comments_page", table_name="comments")
    op.drop_index("ix_comments_workspace", table_name="comments")
    op.drop_table("comments")
