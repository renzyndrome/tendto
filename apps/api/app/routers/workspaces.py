"""Shared-workspace collaboration — invites + members.

The upload path (routers/sync.py) already enforces membership+role on every write, and the
sync rules only download workspaces a user is a member of. This router adds the *membership
lifecycle*: an owner mints a shareable invite link; anyone signed in can preview it and accept
it (which creates their membership row → they immediately start syncing that workspace); owners
list and remove members.

Memberships/invites are server-authoritative (not client-writable): the sync `memberships`
table downloads to devices for the sidebar, but its rows are only ever created here, behind the
owner/role checks — never through the generic upload path (a non-member can't fabricate one, and
`_assert_can_write` requires owner/editor of the *target* workspace, which a stranger isn't).
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import bindparam, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.db import get_session
from app.models.core import Invite, Membership, Workspace
from app.schemas.workspaces import (
    INVITABLE_ROLES,
    AcceptInviteResult,
    CreateInviteRequest,
    CreateWorkspaceRequest,
    InviteInfo,
    InvitePreview,
    MemberInfo,
    MemberList,
    WorkspaceInfo,
)

router = APIRouter(prefix="/workspaces", tags=["workspaces"])

INVITE_TTL = timedelta(days=7)


@router.post("", response_model=WorkspaceInfo)
async def create_workspace(
    body: CreateWorkspaceRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceInfo:
    """Create a new workspace with the caller as owner. Each user can own many; every workspace
    invites independently. (POST /bootstrap still seeds the first, personal one.)"""
    workspace = Workspace(id=uuid4(), name=body.name.strip() or "Untitled")
    session.add(workspace)
    # Flush the workspace before the membership FK references it (no ORM relationship configured).
    await session.flush()
    session.add(
        Membership(id=uuid4(), user_id=user.id, workspace_id=workspace.id, role="owner")
    )
    await session.commit()
    return WorkspaceInfo(id=workspace.id, name=workspace.name, role="owner")


async def _role_in(session: AsyncSession, user_id: str, workspace_id: UUID) -> str | None:
    return await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
        )
    )


async def _require_owner(session: AsyncSession, user: CurrentUser, workspace_id: UUID) -> None:
    if await _role_in(session, user.id, workspace_id) != "owner":
        raise HTTPException(status_code=403, detail="Only the workspace owner can do that")


async def _display_names(
    session: AsyncSession, user_ids: list[str]
) -> dict[str, tuple[str | None, str | None]]:
    """Resolve better-auth user ids → (name, email) for the member UI. Best-effort: the `user`
    table is owned by the auth service (not our SQLAlchemy metadata), so this is a read-only
    lookup that degrades to empty (e.g. in tests, where that table doesn't exist)."""
    if not user_ids:
        return {}
    stmt = text('SELECT id, name, email FROM "user" WHERE id IN :ids').bindparams(
        bindparam("ids", expanding=True)
    )
    try:
        # SAVEPOINT: if the `user` table is absent (tests), the failed query rolls back only this
        # nested block — the outer transaction stays usable for the rest of the endpoint.
        async with session.begin_nested():
            rows = (await session.execute(stmt, {"ids": user_ids})).all()
        return {row.id: (row.name, row.email) for row in rows}
    except Exception:
        return {}


@router.post("/invites", response_model=InviteInfo)
async def create_invite(
    body: CreateInviteRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InviteInfo:
    """Owner-only: mint a single-use, 7-day shareable invite link for a workspace."""
    if body.role not in INVITABLE_ROLES:
        raise HTTPException(status_code=400, detail="Role must be editor or viewer")
    await _require_owner(session, user, body.workspace_id)

    invite = Invite(
        id=uuid4(),
        workspace_id=body.workspace_id,
        token=secrets.token_urlsafe(24),
        role=body.role,
        email=body.email,
        created_by=user.id,
        expires_at=datetime.now(UTC) + INVITE_TTL,
    )
    session.add(invite)
    await session.commit()
    return InviteInfo(
        token=invite.token,
        workspace_id=invite.workspace_id,
        role=invite.role,
        email=invite.email,
        expires_at=invite.expires_at,
        accepted_by=invite.accepted_by,
    )


def _aware(dt: datetime) -> datetime:
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=UTC)


@router.get("/invites/{token}", response_model=InvitePreview)
async def preview_invite(
    token: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> InvitePreview:
    """What the invitee sees before joining. Signed-in required (so we can accept right after)."""
    invite = await session.scalar(select(Invite).where(Invite.token == token))
    if invite is None:
        return InvitePreview(
            workspace_id=uuid4(), workspace_name="", role="", valid=False, reason="not_found"
        )
    name = await session.scalar(select(Workspace.name).where(Workspace.id == invite.workspace_id))
    reason: str | None = None
    if invite.accepted_by is not None:
        reason = "accepted"
    elif _aware(invite.expires_at) < datetime.now(UTC):
        reason = "expired"
    return InvitePreview(
        workspace_id=invite.workspace_id,
        workspace_name=name or "Workspace",
        role=invite.role,
        valid=reason is None,
        reason=reason,
    )


@router.post("/invites/{token}/accept", response_model=AcceptInviteResult)
async def accept_invite(
    token: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> AcceptInviteResult:
    """Redeem an invite → create the caller's membership (idempotent if already a member)."""
    invite = await session.scalar(select(Invite).where(Invite.token == token))
    if invite is None:
        raise HTTPException(status_code=404, detail="Invite not found")
    if _aware(invite.expires_at) < datetime.now(UTC):
        raise HTTPException(status_code=410, detail="This invite has expired")

    name = await session.scalar(select(Workspace.name).where(Workspace.id == invite.workspace_id))
    if name is None:
        raise HTTPException(status_code=404, detail="Workspace no longer exists")

    existing = await _role_in(session, user.id, invite.workspace_id)
    if existing is not None:
        # Already in — don't downgrade their role, just report success (link is a no-op for them).
        return AcceptInviteResult(
            workspace_id=invite.workspace_id,
            workspace_name=name,
            role=existing,
            already_member=True,
        )

    if invite.accepted_by is not None:
        # Single-use and already spent by someone else.
        raise HTTPException(status_code=410, detail="This invite has already been used")

    session.add(
        Membership(
            id=uuid4(),
            user_id=user.id,
            workspace_id=invite.workspace_id,
            role=invite.role,
        )
    )
    invite.accepted_by = user.id
    invite.accepted_at = datetime.now(UTC)
    await session.commit()
    return AcceptInviteResult(
        workspace_id=invite.workspace_id,
        workspace_name=name,
        role=invite.role,
        already_member=False,
    )


@router.get("/{workspace_id}/members", response_model=MemberList)
async def list_members(
    workspace_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> MemberList:
    """Members + pending invites. Any member may view; only owners see it in the Share UI."""
    if await _role_in(session, user.id, workspace_id) is None:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")

    member_rows = (
        await session.execute(
            select(Membership.user_id, Membership.role)
            .where(Membership.workspace_id == workspace_id)
            .order_by(Membership.created_at)
        )
    ).all()
    names = await _display_names(session, [r.user_id for r in member_rows])
    invite_rows = await session.execute(
        select(Invite)
        .where(Invite.workspace_id == workspace_id, Invite.accepted_by.is_(None))
        .order_by(Invite.created_at.desc())
    )
    return MemberList(
        members=[
            MemberInfo(
                user_id=r.user_id,
                role=r.role,
                name=names.get(r.user_id, (None, None))[0],
                email=names.get(r.user_id, (None, None))[1],
            )
            for r in member_rows
        ],
        invites=[
            InviteInfo(
                token=i.token,
                workspace_id=i.workspace_id,
                role=i.role,
                email=i.email,
                expires_at=i.expires_at,
                accepted_by=i.accepted_by,
            )
            for i in invite_rows.scalars()
        ],
    )


@router.delete("/{workspace_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    workspace_id: UUID,
    member_user_id: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Owner-only: remove a member. Can't remove the last owner (would orphan the workspace)."""
    await _require_owner(session, user, workspace_id)

    target_role = await _role_in(session, member_user_id, workspace_id)
    if target_role is None:
        return  # idempotent: already not a member
    if target_role == "owner":
        owners = (
            (
                await session.execute(
                    select(Membership.user_id).where(
                        Membership.workspace_id == workspace_id, Membership.role == "owner"
                    )
                )
            )
            .scalars()
            .all()
        )
        if len(owners) <= 1:
            raise HTTPException(status_code=409, detail="Cannot remove the only owner")

    membership = await session.scalar(
        select(Membership).where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == member_user_id,
        )
    )
    if membership is not None:
        await session.delete(membership)
        await session.commit()
