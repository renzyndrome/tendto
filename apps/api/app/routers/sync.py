"""The authoritative write path.

The PowerSync client's `uploadData()` posts queued CRUD entries here. This endpoint is the
UPLOAD tenancy boundary (docs/planning/05 §isolation): membership + role are checked per
entry before anything touches Postgres. Conflict policy: last-write-wins at row granularity,
with `last_seen_updated_at` used to report "updated elsewhere" back to the client.

Idempotency: every entry is keyed by a client-generated id and applied via upsert/delete, so
replaying the upload queue is safe. `updated_at` is taken from the client's row data (never
stamped server-side), which keeps replays deterministic and LWW comparisons meaningful.
"""

import json
from datetime import UTC, datetime
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import Block, Collection, Item, Membership, Page, Workspace
from app.schemas.sync import CrudEntry, Op, UploadBatch, UploadResult

router = APIRouter(prefix="/sync", tags=["sync"])

# table name -> mapped model. Also the set of tables the upload path will accept.
TABLE_MODELS = {
    "workspaces": Workspace,
    "memberships": Membership,
    "pages": Page,
    "blocks": Block,
    "collections": Collection,
    "items": Item,
}
# JSONB columns arrive from the client as JSON strings and must be parsed before binding.
JSON_COLUMNS: dict[str, set[str]] = {
    "blocks": {"content"},
    "items": {"properties"},
    "collections": {"config"},
}
# Columns the client is never allowed to drive directly on a write.
_RESERVED_COLUMNS = {"id", "created_at", "updated_at"}
WRITE_ROLES = {"owner", "editor"}


# --- datetime helpers -------------------------------------------------------------------


def _aware(dt: datetime) -> datetime:
    """Treat naive timestamps as UTC so comparisons never raise."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


def _parse_dt(value: Any) -> datetime:
    """Parse a client-supplied timestamp (ISO string or datetime) to an aware datetime."""
    if isinstance(value, datetime):
        return _aware(value)
    return _aware(datetime.fromisoformat(str(value)))


def _incoming_updated_at(data: dict[str, Any], server_updated_at: datetime | None) -> datetime:
    """The client's edit time for the row. Falls back to the stored value (keeping replays
    idempotent) and finally to now() only for the pathological missing-timestamp case."""
    raw = data.get("updated_at")
    if raw is not None:
        return _parse_dt(raw)
    if server_updated_at is not None:
        return _aware(server_updated_at)
    return datetime.now(UTC)


def _row_values(table: str, data: dict[str, Any]) -> dict[str, Any]:
    """Filter client data to real, writable columns and parse JSONB string columns."""
    columns = {c.name for c in TABLE_MODELS[table].__table__.columns}
    json_columns = JSON_COLUMNS.get(table, set())
    values: dict[str, Any] = {}
    for key, value in data.items():
        if key not in columns or key in _RESERVED_COLUMNS:
            continue
        if key in json_columns and isinstance(value, str):
            value = json.loads(value)
        values[key] = value
    return values


# --- permission check -------------------------------------------------------------------


async def _resolve_workspace_id(session: AsyncSession, entry: CrudEntry) -> Any | None:
    """The workspace an entry writes into, resolved for the permission check.

    For an **existing** row the *stored* workspace_id is authoritative — never the
    client-supplied one — so a client that knows a row's id can't authorize a write against
    a workspace it belongs to and thereby move the row across tenants (the actual relocation
    is separately blocked in `_apply_entry`). Only a brand-new row trusts `data`.
    For `workspaces` the tenant key is the row id itself.
    """
    if entry.table == "workspaces":
        return entry.id
    model = TABLE_MODELS[entry.table]
    stored_workspace_id = await session.scalar(
        select(model.workspace_id).where(model.id == entry.id)
    )
    if stored_workspace_id is not None:
        return stored_workspace_id
    if entry.data is not None and entry.data.get("workspace_id") is not None:
        return entry.data["workspace_id"]
    return None


async def _assert_can_write(
    session: AsyncSession, user: CurrentUser, entry: CrudEntry
) -> Any | None:
    """Require the user to be an owner/editor of the entry's target workspace, else 403.
    Returns the resolved (authoritative) workspace_id so the apply step can pin the row's
    tenant to it.

    Workspaces + memberships are provisioned by POST /bootstrap, so a legitimate writer is
    already a member; there is no "create a brand-new workspace" path through here.
    """
    workspace_id = await _resolve_workspace_id(session, entry)
    if workspace_id is None:
        # Only reachable for a DELETE of a row that no longer exists: an idempotent no-op
        # with nothing to authorize against. Anything else with no resolvable workspace is
        # a malformed write.
        if entry.op is Op.DELETE:
            return None
        raise HTTPException(status_code=403, detail="Cannot determine target workspace")
    role = await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user.id,
            Membership.workspace_id == workspace_id,
        )
    )
    if role not in WRITE_ROLES:
        raise HTTPException(status_code=403, detail="No write access to this workspace")
    return workspace_id


# --- apply ------------------------------------------------------------------------------


async def _apply_entry(session: AsyncSession, entry: CrudEntry, workspace_id: Any | None) -> bool:
    """Apply one entry idempotently, last-write-wins at row granularity. `workspace_id` is the
    authoritative tenant resolved during the permission check (stored value for existing rows).

    Returns whether a conflict was detected — i.e. the server row was already newer than the
    state the client last saw (`last_seen_updated_at`). The conflict flag is reported to the
    client regardless of whether this write was applied or dropped.
    """
    model = TABLE_MODELS[entry.table]
    table = model.__table__
    server_updated_at: datetime | None = await session.scalar(
        select(model.updated_at).where(model.id == entry.id)
    )
    row_exists = server_updated_at is not None

    last_seen = _aware(entry.last_seen_updated_at) if entry.last_seen_updated_at else None
    conflict = row_exists and last_seen is not None and _aware(server_updated_at) > last_seen

    if entry.op is Op.DELETE:
        # Deletes carry no client timestamp, so they apply unconditionally and idempotently.
        await session.execute(delete(table).where(table.c.id == entry.id))
        return conflict

    data = entry.data or {}
    incoming = _incoming_updated_at(data, server_updated_at)
    if row_exists and incoming < _aware(server_updated_at):
        return conflict  # stale write: keep the newer server row (last-write-wins)

    values = _row_values(entry.table, data)
    values["updated_at"] = incoming
    # Pin the tenant column to the authoritative workspace: for a new row that's the
    # (authorized) target; for an existing row it's the *stored* workspace, so a write can
    # never relocate a row across tenants even if the client supplies a foreign workspace_id.
    if workspace_id is not None and "workspace_id" in table.c:
        values["workspace_id"] = workspace_id

    if entry.op is Op.PUT:
        stmt = pg_insert(table).values(id=entry.id, **values)
        stmt = stmt.on_conflict_do_update(
            index_elements=[table.c.id],
            set_={c: stmt.excluded[c] for c in values},
            where=table.c.updated_at <= incoming,
        )
        await session.execute(stmt)
    elif row_exists:  # PATCH only touches an existing row
        await session.execute(
            update(table)
            .where(table.c.id == entry.id, table.c.updated_at <= incoming)
            .values(**values)
        )
    return conflict


@router.post("/upload", response_model=UploadResult)
async def upload(
    batch: UploadBatch,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResult:
    conflicts: list[str] = []
    for entry in batch.entries:
        if entry.table not in TABLE_MODELS:
            raise HTTPException(status_code=400, detail=f"Unknown table: {entry.table}")
        workspace_id = await _assert_can_write(session, user, entry)
        if await _apply_entry(session, entry, workspace_id):
            conflicts.append(entry.id)
    await session.commit()
    return UploadResult(applied=len(batch.entries) - len(conflicts), conflicts=conflicts)
