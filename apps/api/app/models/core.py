"""Core SQLAlchemy models.

Invariants (CLAUDE.md):
- IDs are client-generated UUIDs (server accepts them; uniqueness enforced by PK).
- Every synced row carries `updated_at` (LWW conflict checks) and `workspace_id` (tenancy).
- Any new synced table must be added to infra/powersync/sync-rules.yaml and
  apps/web/src/lib/powersync/schema.ts — see the `sync-rules` skill.
"""

import uuid
from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, Index, Integer, String, Text, func
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
    __tablename__ = "blocks"
    __table_args__ = (Index("ix_blocks_page", "page_id"),)

    # Block ids are BlockNote-owned strings, NOT UUIDs — the one synced PK that is
    # not a UUID column. Everything else keys off client-generated UUIDs.
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    workspace_id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), nullable=False)
    page_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pages.id", ondelete="CASCADE"), nullable=False
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
