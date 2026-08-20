"""Core SQLAlchemy models.

Invariants (CLAUDE.md):
- IDs are client-generated UUIDs (server accepts them; uniqueness enforced by PK).
- Every synced row carries `updated_at` (LWW conflict checks).
- Tenancy: WORKSPACE-scoped tables carry `workspace_id` and ride the `workspace_content`
  bucket. A table holding PERSONAL data carries `user_id` instead and rides `user_private` —
  `workspace_content` fans every row out to every member of the workspace, so putting personal
  data there leaks it (see FocusSession below). Choosing wrong is a one-way door.
- Any new synced table must be added to infra/powersync/sync-rules.yaml,
  apps/web/src/lib/powersync/schema.ts, and `TABLE_MODELS` in app/routers/sync.py (which is the
  upload allowlist as well as the dispatch map) — see the `sync-rules` skill.
"""

import uuid
from datetime import datetime

from sqlalchemy import (
    CheckConstraint,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
    UniqueConstraint,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class TimestampMixin:
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now(), nullable=False
    )


class Workspace(TimestampMixin, Base):
    __tablename__ = "workspaces"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # org_id comes later (Organizations, Phase 2 public-SaaS work)


class Membership(TimestampMixin, Base):
    __tablename__ = "memberships"
    __table_args__ = (Index("ix_memberships_user", "user_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    user_id: Mapped[str] = mapped_column(String(64), nullable=False)  # better-auth user id
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="owner")
    # roles: owner | editor | viewer (commenter later)


class WorkspaceInvitation(TimestampMixin, Base):
    """A pending invitation to join a workspace.

    Deliberately NOT a synced table: it holds other people's email addresses and a bearer
    token, neither of which belongs on every member's device. It is therefore absent from
    sync-rules.yaml and the client schema — the settings panel reads it over the API.
    """

    __tablename__ = "workspace_invitations"
    __table_args__ = (
        Index("ix_workspace_invitations_workspace", "workspace_id"),
        Index("ix_workspace_invitations_email", "email"),
        # One live invite per (workspace, email); re-inviting updates the existing row.
        UniqueConstraint("workspace_id", "email", name="uq_workspace_invitation_email"),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    # Stored lowercased; matched against the accepting user's email.
    email: Mapped[str] = mapped_column(String(320), nullable=False)
    role: Mapped[str] = mapped_column(String(16), nullable=False, default="editor")
    # Unguessable bearer token from the invite link. Unique so a lookup can't be ambiguous.
    token: Mapped[str] = mapped_column(String(64), nullable=False, unique=True)
    invited_by: Mapped[str] = mapped_column(String(64), nullable=False)  # better-auth user id
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)


class Page(TimestampMixin, Base):
    __tablename__ = "pages"
    __table_args__ = (Index("ix_pages_workspace", "workspace_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    parent_id: Mapped[uuid.UUID | None] = mapped_column(UUID(as_uuid=True), nullable=True)
    title: Mapped[str] = mapped_column(Text, nullable=False, default="")
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Block(TimestampMixin, Base):
    """A block belongs to exactly ONE owner: a page, or an item's description.

    Item descriptions reuse blocks rather than getting their own table so the editor, the
    serializer, search and export all keep working unchanged — a card's body is the same
    primitive as a page's body, which is the product's "same data, many views" idea applied
    one level down. The XOR is enforced in the database, not just in code, because both
    columns arrive from a client.
    """

    __tablename__ = "blocks"
    __table_args__ = (
        Index("ix_blocks_page", "page_id"),
        Index("ix_blocks_item", "item_id"),
        CheckConstraint(
            "(page_id IS NOT NULL) <> (item_id IS NOT NULL)",
            name="ck_blocks_exactly_one_owner",
        ),
    )

    # Block ids are BlockNote-owned strings, NOT UUIDs — the one synced PK that is
    # not a UUID column. Everything else keys off client-generated UUIDs.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=True
    )
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), nullable=True
    )
    type: Mapped[str] = mapped_column(String(32), nullable=False)  # curated set only
    content: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Collection(TimestampMixin, Base):
    __tablename__ = "collections"
    __table_args__ = (Index("ix_collections_workspace", "workspace_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    default_view: Mapped[str] = mapped_column(String(16), nullable=False, default="checklist")
    # views: checklist | list | table | board | calendar
    # Per-collection view config, e.g. {"columns": [{"id": "todo", "label": "To do"}, ...]} for
    # the board's status columns. Empty ⇒ the client falls back to the default three columns.
    config: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict, server_default="{}")


class Item(TimestampMixin, Base):
    __tablename__ = "items"
    __table_args__ = (Index("ix_items_collection", "collection_id"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    collection_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("collections.id", ondelete="CASCADE"), nullable=False
    )
    properties: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    # e.g. {"title": "...", "done": false, "status": "todo", "due": "2026-07-10", ...}
    position: Mapped[int] = mapped_column(Integer, nullable=False, default=0)


class Comment(TimestampMixin, Base):
    """A comment on a page or a card — team-visible by design.

    Comments ride the `workspace_content` bucket (every member sees them; that is the point),
    but each row is additionally AUTHOR-owned: sync.py pins `author_id` to the token subject on
    create and only lets the author edit — the workspace owner may delete, never edit. Same XOR
    ownership as Block: a comment belongs to exactly one page or one item, enforced in the
    database because both columns arrive from a client.

    `author_label` is the author's name-or-email denormalized at write time, because user names
    live only in better-auth's tables and never sync — without it a comment could not render
    offline. It is cosmetic and client-supplied; the identity guarantee rides `author_id`.

    `body` is plain text with inline mention tokens `@[<user_id>:<label>]` — no JSONB, no
    client timestamp columns, so JSON_COLUMNS/DATETIME_COLUMNS in sync.py stay untouched.
    Mentions render highlighted and nothing more: no notifications, ever (docs/planning/03
    §guardrails, collaboration noise).
    """

    __tablename__ = "comments"
    __table_args__ = (
        Index("ix_comments_workspace", "workspace_id"),
        Index("ix_comments_page", "page_id"),
        Index("ix_comments_item", "item_id"),
        CheckConstraint(
            "(page_id IS NOT NULL) <> (item_id IS NOT NULL)",
            name="ck_comments_exactly_one_owner",
        ),
    )

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("workspaces.id", ondelete="CASCADE"), nullable=False
    )
    page_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=True
    )
    item_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("items.id", ondelete="CASCADE"), nullable=True
    )
    # better-auth user id: String(64), no FK (see memberships.user_id).
    author_id: Mapped[str] = mapped_column(String(64), nullable=False)
    author_label: Mapped[str] = mapped_column(String(320), nullable=False)
    body: Mapped[str] = mapped_column(Text, nullable=False)
    # When the comment was WRITTEN, per the device that wrote it — what the thread sorts and
    # dates by. `created_at` cannot serve: it is reserved, so the server stamps it at UPLOAD
    # time, and a comment written offline on Monday would read "just now" on Friday and sort
    # after everything said in between. Same reason `focus_sessions.started_at` exists.
    authored_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # NULL until the author edits. Explicit rather than derived from updated_at > created_at:
    # those are two different clocks (the device's and the server's), so their difference means
    # nothing — it can hide a quick edit and invent one that never happened.
    edited_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class FocusSession(TimestampMixin, Base):
    """A COMPLETED Pomodoro work session — the first USER-owned synced table.

    Deliberately NOT workspace-scoped. The `workspace_content` bucket sends every row of a
    workspace to every member, so a `workspace_id` here would put your Pomodoro history on your
    teammates' devices — and once data has synced to a device it is on that device
    (docs/planning/05 §isolation). It rides its own user-scoped bucket, `user_private`, and
    `sync.py` authorizes it by owner instead of by membership.
    """

    __tablename__ = "focus_sessions"
    # The only access pattern is "this user's sessions, by day" — the stats below the timer, and
    # the daily summary server-side. `user_id` leads, so this serves a plain owner lookup too.
    __table_args__ = (Index("ix_focus_sessions_user_date", "user_id", "local_date"),)

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)
    # better-auth user id: String(64) and no FK, exactly like memberships.user_id — better-auth
    # owns the `user` table via its own CLI, so it is not in Base.metadata.
    user_id: Mapped[str] = mapped_column(String(64), nullable=False)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    # The user's LOCAL calendar day as a wall-clock LABEL, not an instant — and not derivable
    # from `started_at`, because the server never learns the device's timezone. Without it a
    # 9pm session in UTC+8 files under tomorrow. Same precedent as `items.properties.due`
    # (see apps/web/src/lib/items/due.ts). TEXT rather than Date: the upload path binds client
    # values raw, and asyncpg will not accept a date-shaped string for a date column.
    local_date: Mapped[str] = mapped_column(String(10), nullable=False)  # YYYY-MM-DD
    # Credited focus minutes (the phase's configured length), not elapsed wall time.
    minutes: Mapped[int] = mapped_column(Integer, nullable=False)
