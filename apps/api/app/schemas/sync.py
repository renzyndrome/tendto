"""Schemas for the PowerSync upload path (client → server writes)."""

from datetime import datetime
from enum import StrEnum
from typing import Any
from uuid import UUID

from pydantic import BaseModel


class Op(StrEnum):
    PUT = "PUT"        # insert or full replace
    PATCH = "PATCH"    # partial update
    DELETE = "DELETE"


class CrudEntry(BaseModel):
    """One queued client write, as uploaded by the PowerSync client SDK."""

    op: Op
    table: str
    id: UUID                      # client-generated UUID (idempotency key)
    data: dict[str, Any] | None = None
    # Client-observed updated_at of the row being modified; used for LWW / "updated
    # elsewhere" detection on PATCH.
    last_seen_updated_at: datetime | None = None


class UploadBatch(BaseModel):
    entries: list[CrudEntry]


class UploadResult(BaseModel):
    applied: int
    conflicts: list[UUID] = []    # rows where server state was newer (LWW kept server value)
