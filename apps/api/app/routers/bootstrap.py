"""First-run provisioning.

The sync upload path never creates workspaces (a writer must already be a member), so a
brand-new user needs a workspace + owner membership seeded before they can write anything.
POST /bootstrap does exactly that, idempotently: it creates a personal workspace only if the
user has no membership yet, then returns every workspace the user belongs to.
"""

from uuid import uuid4

from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import Membership, Workspace
from app.schemas.bootstrap import BootstrapResult, WorkspaceMembership

router = APIRouter(tags=["bootstrap"])


@router.post("/bootstrap", response_model=BootstrapResult)
async def bootstrap(
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> BootstrapResult:
    has_membership = await session.scalar(
        select(Membership.id).where(Membership.user_id == user.id).limit(1)
    )
    if has_membership is None:
        workspace = Workspace(id=uuid4(), name="My Workspace")
        session.add(workspace)
        # Flush the workspace before the membership: there is no ORM relationship to teach the
        # unit-of-work the FK insert order, so we sequence it explicitly.
        await session.flush()
        session.add(
            Membership(
                id=uuid4(),
                user_id=user.id,
                workspace_id=workspace.id,
                role="owner",
            )
        )
        await session.commit()

    rows = await session.execute(
        select(Workspace.id, Workspace.name, Membership.role)
        .join(Membership, Membership.workspace_id == Workspace.id)
        .where(Membership.user_id == user.id)
        .order_by(Workspace.created_at)
    )
    return BootstrapResult(
        workspaces=[WorkspaceMembership(id=row.id, name=row.name, role=row.role) for row in rows]
    )
