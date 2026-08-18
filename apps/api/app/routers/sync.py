"""The authoritative write path.

The PowerSync client's `uploadData()` posts queued CRUD entries here. This endpoint is the
UPLOAD tenancy boundary (docs/planning/05 §isolation): every entry is authorized before
anything touches Postgres. Two ownership models — workspace tables check membership + role;
USER-owned tables check that the row belongs to the token subject. Conflict policy:
last-write-wins at row granularity, with `last_seen_updated_at` used to report
"updated elsewhere" back to the client.

Idempotency: every entry is keyed by a client-generated id and applied via upsert/delete, so
replaying the upload queue is safe. `updated_at` is taken from the client's row data (never
stamped server-side), which keeps replays deterministic and LWW comparisons meaningful.
"""

import json
from datetime import UTC, datetime
from typing import Any, NamedTuple

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import (
    Block,
    Collection,
    FocusSession,
    Item,
    Membership,
    Page,
    Workspace,
)
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
    "focus_sessions": FocusSession,
}
# Tables owned by a USER rather than a workspace: they carry `user_id` instead of
# `workspace_id`, are authorized against the token subject, and ride the `user_private` sync
# bucket. Personal data must never go in `workspace_content`, which fans every row out to every
# member of the workspace. Subset of TABLE_MODELS.
USER_OWNED_TABLES = {"focus_sessions"}
# JSONB columns arrive from the client as JSON strings and must be parsed before binding.
JSON_COLUMNS: dict[str, set[str]] = {
    "blocks": {"content"},
    "items": {"properties"},
    "collections": {"config"},
}
# Client-supplied timestamp columns also arrive as ISO strings, and asyncpg binds a
# `timestamptz` from a datetime ONLY — a raw string raises, which 500s the whole batch. Because
# the client's uploadData re-raises without completing the transaction, and the queue is
# ordered, that would wedge the device's uploads permanently. `updated_at` is parsed separately
# in `_apply_entry` and `created_at` is reserved, so this covers everything else.
DATETIME_COLUMNS: dict[str, set[str]] = {
    "focus_sessions": {"started_at"},
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
    """Filter client data to real, writable columns, parsing the ones that cannot bind raw."""
    columns = {c.name for c in TABLE_MODELS[table].__table__.columns}
    json_columns = JSON_COLUMNS.get(table, set())
    datetime_columns = DATETIME_COLUMNS.get(table, set())
    values: dict[str, Any] = {}
    for key, value in data.items():
        if key not in columns or key in _RESERVED_COLUMNS:
            continue
        if key in json_columns and isinstance(value, str):
            value = json.loads(value)
        elif key in datetime_columns and value is not None:
            value = _parse_dt(value)
        values[key] = value
    return values


# --- permission check -------------------------------------------------------------------


class OwnerPin(NamedTuple):
    """The authoritative owner of a row: which column pins it, and to what value.

    Workspace tables pin `workspace_id`; user-owned tables pin `user_id`. Pinning is what stops
    a client that merely knows a row's id from relocating that row to another owner — the apply
    step overwrites the column with this value rather than trusting the client's copy.
    """

    column: str
    value: Any


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


async def _assert_owns_row(
    session: AsyncSession, user: CurrentUser, entry: CrudEntry
) -> OwnerPin | None:
    """Authorize a USER-owned row against the token subject — no membership involved.

    Same shape as the workspace path: for an EXISTING row the *stored* user_id is
    authoritative, so knowing a row's id never grants a write to somebody else's row. For a
    brand-new row the writer is the owner by definition, so a client-supplied `user_id` is
    ignored outright rather than validated — there is no legitimate value but the token subject.
    """
    model = TABLE_MODELS[entry.table]
    stored_user_id = await session.scalar(select(model.user_id).where(model.id == entry.id))
    if stored_user_id is not None:
        if stored_user_id != user.id:
            raise HTTPException(status_code=403, detail="Not your row")
        return OwnerPin("user_id", stored_user_id)
    if entry.op is Op.DELETE:
        return None  # idempotent no-op: the row is gone, nothing left to authorize against
    return OwnerPin("user_id", user.id)


async def _assert_can_write(
    session: AsyncSession, user: CurrentUser, entry: CrudEntry
) -> OwnerPin | None:
    """Authorize one entry, or raise 403. Returns the authoritative owner so the apply step can
    pin the row to it.

    Workspace tables require the user to be an owner/editor of the target workspace. Workspaces
    + memberships are provisioned by POST /bootstrap, so a legitimate writer is already a
    member; there is no "create a brand-new workspace" path through here.

    USER-owned tables branch out first: they have no `workspace_id` at all, so the membership
    check cannot apply — and `_resolve_workspace_id` would fail on the missing column.
    """
    if entry.table in USER_OWNED_TABLES:
        return await _assert_owns_row(session, user, entry)
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
    return OwnerPin("workspace_id", workspace_id)


# --- apply ------------------------------------------------------------------------------


async def _apply_entry(session: AsyncSession, entry: CrudEntry, owner: OwnerPin | None) -> bool:
    """Apply one entry idempotently, last-write-wins at row granularity. `owner` is the
    authoritative owner resolved during the permission check (the stored value for an existing
    row), which this step pins onto the row.

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
    # Pin the owner column to the authoritative value: for a new row that's the (authorized)
    # target; for an existing row it's the *stored* owner, so a write can never relocate a row
    # to another tenant or another user even if the client supplies a foreign one. The column
    # check keeps `workspaces` behaving as before — it pins by row id and has no such column.
    if owner is not None and owner.column in table.c:
        values[owner.column] = owner.value

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
        owner = await _assert_can_write(session, user, entry)
        if await _apply_entry(session, entry, owner):
            conflicts.append(entry.id)
    await session.commit()
    return UploadResult(applied=len(batch.entries) - len(conflicts), conflicts=conflicts)
