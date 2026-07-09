"""The authoritative write path.

The PowerSync client's `uploadData()` posts queued CRUD entries here. This endpoint is the
UPLOAD tenancy boundary (docs/planning/05): membership + role are checked per entry before
anything touches Postgres. Conflict policy: last-write-wins at row granularity, with
`last_seen_updated_at` used to report "updated elsewhere" back to the client.

Phase 0 status: skeleton — permission check and per-table apply are stubs to fill in.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.schemas.sync import CrudEntry, UploadBatch, UploadResult

router = APIRouter(prefix="/sync", tags=["sync"])

SYNCED_TABLES = {"workspaces", "memberships", "pages", "blocks", "collections", "items"}
WRITE_ROLES = {"owner", "editor"}


async def _assert_can_write(
    session: AsyncSession, user: CurrentUser, entry: CrudEntry
) -> None:
    """Membership + role check for the entry's workspace. TODO(phase-0): implement."""
    # SELECT role FROM memberships WHERE user_id = :user AND workspace_id = :ws
    # raise HTTPException(403) if not in WRITE_ROLES
    return


async def _apply_entry(session: AsyncSession, entry: CrudEntry) -> bool:
    """Apply one entry idempotently (upsert by client UUID). Returns True if a
    conflict was detected (server row newer than last_seen_updated_at).
    TODO(phase-0): implement per-table upsert/delete.
    """
    return False


@router.post("/upload", response_model=UploadResult)
async def upload(
    batch: UploadBatch,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> UploadResult:
    conflicts = []
    for entry in batch.entries:
        if entry.table not in SYNCED_TABLES:
            raise HTTPException(status_code=400, detail=f"Unknown table: {entry.table}")
        await _assert_can_write(session, user, entry)
        if await _apply_entry(session, entry):
            conflicts.append(entry.id)
    await session.commit()
    return UploadResult(applied=len(batch.entries) - len(conflicts), conflicts=conflicts)
