"""Schemas for the PowerSync upload path (client → server writes)."""

from datetime import datetime
from enum import StrEnum
from typing import Any

from pydantic import BaseModel


class Op(StrEnum):
    PUT = "PUT"  # insert or full replace
    PATCH = "PATCH"  # partial update
    DELETE = "DELETE"


class CrudEntry(BaseModel):
    """One queued client write, as uploaded by the PowerSync client SDK.

    `id` is a plain string, not a UUID: workspace/page/collection/item ids are
    client-generated UUIDs, but block ids are BlockNote-owned strings. asyncpg
    coerces valid UUID strings into the UUID PK columns, so the same field type
    carries both. `data` holds the row's non-id columns (JSONB columns arrive as
    JSON strings and are parsed server-side).
    """

    op: Op
    table: str
    id: str  # client-generated id (idempotency key)
    data: dict[str, Any] | None = None
    # Client-observed updated_at of the row being modified; used for LWW / "updated
    # elsewhere" detection.
    last_seen_updated_at: datetime | None = None


class UploadBatch(BaseModel):
    entries: list[CrudEntry]


class UploadResult(BaseModel):
    applied: int
    conflicts: list[str] = []  # ids where server state was newer than last_seen
