"""Creating additional workspaces.

The sync upload path deliberately refuses to create workspaces — `_assert_can_write` requires
the writer to already be a member, so a client-side INSERT into `workspaces` can never
authorize itself (see routers/sync.py). `/bootstrap` covers only the first-run personal
workspace, so an explicit endpoint is the sanctioned way to make another one: it creates the
workspace and the caller's owner membership in the same transaction, which is exactly the
pair that a client cannot create for itself.

The row syncs back down through the `workspace_content` bucket once the membership exists.
"""

from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import Membership, Workspace
from app.schemas.bootstrap import WorkspaceMembership
from app.schemas.workspaces import CreateWorkspaceRequest

router = APIRouter(tags=["workspaces"])

DEFAULT_NAME = "New Workspace"


async def _role_in(session: AsyncSession, user_id: str, workspace_id: UUID) -> str | None:
    return await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
        )
    )


@router.post("/workspaces", response_model=WorkspaceMembership, status_code=201)
async def create_workspace(
    payload: CreateWorkspaceRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMembership:
    workspace_id = payload.id or uuid4()
    name = payload.name.strip() or DEFAULT_NAME

    existing = await session.get(Workspace, workspace_id)
    if existing is not None:
        # Replay of a create the client already made: return the same row rather than erroring,
        # so a retried/queued request is idempotent.
        role = await _role_in(session, user.id, workspace_id)
        if role is None:
            # The id belongs to someone else's workspace. Refuse — joining a workspace is an
            # invite flow, never a side effect of guessing an id.
            raise HTTPException(status_code=409, detail="Workspace id already in use")
        return WorkspaceMembership(id=existing.id, name=existing.name, role=role)

    session.add(Workspace(id=workspace_id, name=name))
    # Flush the workspace before the membership: there is no ORM relationship to teach the
    # unit-of-work the FK insert order, so we sequence it explicitly (as in /bootstrap).
    await session.flush()
    session.add(Membership(id=uuid4(), user_id=user.id, workspace_id=workspace_id, role="owner"))
    await session.commit()

    return WorkspaceMembership(id=workspace_id, name=name, role="owner")


@router.delete("/workspaces/{workspace_id}", status_code=204)
async def delete_workspace(
    workspace_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Delete a workspace and everything in it, for everyone.

    Owner-only, and deliberately NOT a client-side delete: the upload path's WRITE_ROLES
    includes `editor`, so a local `DELETE FROM workspaces` would let an editor destroy the
    whole tenant. Postgres cascades pages/blocks/collections/items/memberships/invitations
    from the workspace FKs, and the removal reaches every device as a bucket update.
    """
    role = await _role_in(session, user.id, workspace_id)
    if role is None:
        # 404, not 403: never confirm the existence of a workspace to a non-member.
        raise HTTPException(status_code=404, detail="Workspace not found")
    if role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can delete a workspace")

    remaining = (
        await session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.user_id == user.id, Membership.workspace_id != workspace_id)
        )
        or 0
    )
    if remaining == 0:
        # Deleting your only workspace would drop you into an app with nowhere to write;
        # /bootstrap would then silently provision a fresh empty one, which reads as data loss.
        raise HTTPException(
            status_code=409, detail="You can't delete your only workspace. Create another first."
        )

    await session.execute(delete(Workspace).where(Workspace.id == workspace_id))
    await session.commit()
