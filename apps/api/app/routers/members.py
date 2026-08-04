"""Workspace members and invitations — the sharing surface.

Invitations live here rather than in better-auth's organization plugin on purpose. That
plugin invites people to an *organization*, but TendTo's tenancy is
`memberships(user, workspace, role)` and `workspaces` has no `org_id` yet, so using it would
mean one org per workspace AND workspace/role semantics living inside `apps/auth` — which is
infrastructure only ("FastAPI is the only product server", docs/planning 02/07). When
Organizations land, the org plugin can own ORG membership while workspace membership stays
here.

Every endpoint re-derives the caller's role from `memberships`; nothing trusts the client.
"""

import secrets
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.auth_users import email_for_user, emails_for, find_user_id_by_email, workspace_name
from app.config import get_settings
from app.db import get_session
from app.email.provider import EmailProvider, get_email_provider
from app.models.core import Membership, WorkspaceInvitation
from app.schemas.members import (
    ROLES,
    Invitation,
    InvitationPreview,
    InviteRequest,
    InviteResult,
    Member,
    RoleUpdate,
    WorkspaceMembers,
)

router = APIRouter(tags=["members"])


# --- helpers ----------------------------------------------------------------------------


async def _role_of(session: AsyncSession, user_id: str, workspace_id: UUID) -> str | None:
    return await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user_id,
            Membership.workspace_id == workspace_id,
        )
    )


async def _require_member(session: AsyncSession, user: CurrentUser, workspace_id: UUID) -> str:
    role = await _role_of(session, user.id, workspace_id)
    if role is None:
        # 404, not 403: a non-member must not learn whether a workspace id exists.
        raise HTTPException(status_code=404, detail="Workspace not found")
    return role


async def _require_owner(session: AsyncSession, user: CurrentUser, workspace_id: UUID) -> str:
    role = await _require_member(session, user, workspace_id)
    if role != "owner":
        raise HTTPException(status_code=403, detail="Only an owner can do that")
    return role


async def _owner_count(session: AsyncSession, workspace_id: UUID) -> int:
    return (
        await session.scalar(
            select(func.count())
            .select_from(Membership)
            .where(Membership.workspace_id == workspace_id, Membership.role == "owner")
        )
        or 0
    )


def _validate_role(role: str, *, allow_owner: bool = True) -> str:
    if role not in ROLES or (role == "owner" and not allow_owner):
        raise HTTPException(status_code=422, detail=f"Role must be one of {', '.join(ROLES)}")
    return role


def _invite_url(token: str) -> str:
    return f"{get_settings().web_url.rstrip('/')}/invite/{token}"


def _to_invitation(row: WorkspaceInvitation) -> Invitation:
    return Invitation(id=row.id, email=row.email, role=row.role, expires_at=row.expires_at)


# --- members ----------------------------------------------------------------------------


@router.get("/workspaces/{workspace_id}/members", response_model=WorkspaceMembers)
async def list_members(
    workspace_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> WorkspaceMembers:
    your_role = await _require_member(session, user, workspace_id)

    rows = (
        await session.execute(
            select(Membership.user_id, Membership.role)
            .where(Membership.workspace_id == workspace_id)
            .order_by(Membership.created_at)
        )
    ).all()
    profiles = await emails_for(session, [row.user_id for row in rows])
    members = [
        Member(
            user_id=row.user_id,
            email=profiles.get(row.user_id, {}).get("email"),
            name=profiles.get(row.user_id, {}).get("name"),
            role=row.role,
            is_you=row.user_id == user.id,
        )
        for row in rows
    ]

    # Pending invites are owner-only: they are other people's email addresses.
    invitations: list[Invitation] = []
    if your_role == "owner":
        invite_rows = (
            await session.scalars(
                select(WorkspaceInvitation)
                .where(WorkspaceInvitation.workspace_id == workspace_id)
                .order_by(WorkspaceInvitation.created_at)
            )
        ).all()
        invitations = [_to_invitation(row) for row in invite_rows]

    return WorkspaceMembers(members=members, invitations=invitations, your_role=your_role)


@router.patch("/workspaces/{workspace_id}/members/{member_user_id}", response_model=Member)
async def update_member_role(
    workspace_id: UUID,
    member_user_id: str,
    payload: RoleUpdate,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> Member:
    await _require_owner(session, user, workspace_id)
    role = _validate_role(payload.role)

    current = await _role_of(session, member_user_id, workspace_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Not a member of this workspace")
    if current == "owner" and role != "owner" and await _owner_count(session, workspace_id) <= 1:
        # Demoting the only owner would leave the workspace unmanageable (nobody could
        # invite, change roles, or delete it).
        raise HTTPException(status_code=409, detail="A workspace needs at least one owner")

    await session.execute(
        update(Membership)
        .where(Membership.workspace_id == workspace_id, Membership.user_id == member_user_id)
        .values(role=role, updated_at=datetime.now(UTC))
    )
    await session.commit()

    profiles = await emails_for(session, [member_user_id])
    return Member(
        user_id=member_user_id,
        email=profiles.get(member_user_id, {}).get("email"),
        name=profiles.get(member_user_id, {}).get("name"),
        role=role,
        is_you=member_user_id == user.id,
    )


@router.delete("/workspaces/{workspace_id}/members/{member_user_id}", status_code=204)
async def remove_member(
    workspace_id: UUID,
    member_user_id: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    # Anyone may remove THEMSELVES (leave); removing anyone else is owner-only.
    if member_user_id == user.id:
        await _require_member(session, user, workspace_id)
    else:
        await _require_owner(session, user, workspace_id)

    current = await _role_of(session, member_user_id, workspace_id)
    if current is None:
        raise HTTPException(status_code=404, detail="Not a member of this workspace")
    if current == "owner" and await _owner_count(session, workspace_id) <= 1:
        raise HTTPException(status_code=409, detail="A workspace needs at least one owner")

    await session.execute(
        delete(Membership).where(
            Membership.workspace_id == workspace_id,
            Membership.user_id == member_user_id,
        )
    )
    await session.commit()


# --- invitations ------------------------------------------------------------------------


@router.post("/workspaces/{workspace_id}/invitations", response_model=InviteResult, status_code=201)
async def invite_member(
    workspace_id: UUID,
    payload: InviteRequest,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
    email_provider: EmailProvider = Depends(get_email_provider),
) -> InviteResult:
    await _require_owner(session, user, workspace_id)
    role = _validate_role(payload.role)
    email = payload.email.strip().lower()

    # Already a member? Nothing to invite.
    existing_user_id = await find_user_id_by_email(session, email)
    if existing_user_id and await _role_of(session, existing_user_id, workspace_id):
        raise HTTPException(status_code=409, detail="Already a member of this workspace")

    expires_at = datetime.now(UTC) + timedelta(hours=get_settings().invite_ttl_hours)
    token = secrets.token_urlsafe(32)

    # Re-inviting the same address refreshes the existing row (new token + expiry) instead of
    # accumulating duplicates — the unique constraint enforces one live invite per address.
    invitation = await session.scalar(
        select(WorkspaceInvitation).where(
            WorkspaceInvitation.workspace_id == workspace_id,
            WorkspaceInvitation.email == email,
        )
    )
    if invitation is None:
        invitation = WorkspaceInvitation(
            id=uuid4(),
            workspace_id=workspace_id,
            email=email,
            role=role,
            token=token,
            invited_by=user.id,
            expires_at=expires_at,
        )
        session.add(invitation)
    else:
        invitation.role = role
        invitation.token = token
        invitation.invited_by = user.id
        invitation.expires_at = expires_at
        invitation.updated_at = datetime.now(UTC)
    await session.commit()
    await session.refresh(invitation)

    name = await workspace_name(session, workspace_id) or "a workspace"
    url = _invite_url(invitation.token)
    result = await email_provider.send(
        to=email,
        subject=f"You've been invited to {name} on TendTo",
        text=(
            f"You've been invited to join “{name}” on TendTo as {role}.\n\n"
            f"Open this link to accept:\n{url}\n\n"
            "If you weren't expecting this, you can ignore it."
        ),
    )

    return InviteResult(
        invitation=_to_invitation(invitation),
        invite_url=url,
        email_delivered=result.delivered,
        detail=result.detail,
    )


@router.delete("/workspaces/{workspace_id}/invitations/{invitation_id}", status_code=204)
async def revoke_invitation(
    workspace_id: UUID,
    invitation_id: UUID,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    await _require_owner(session, user, workspace_id)
    await session.execute(
        delete(WorkspaceInvitation).where(
            WorkspaceInvitation.id == invitation_id,
            WorkspaceInvitation.workspace_id == workspace_id,
        )
    )
    await session.commit()


@router.get("/invitations/{token}", response_model=InvitationPreview)
async def preview_invitation(
    token: str,
    session: AsyncSession = Depends(get_session),
) -> InvitationPreview:
    """Unauthenticated: the recipient may need to sign up before accepting. Reveals only the
    workspace name, the offered role, and the invited address — never its contents."""
    invitation = await session.scalar(
        select(WorkspaceInvitation).where(WorkspaceInvitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    name = await workspace_name(session, invitation.workspace_id) or "a workspace"
    return InvitationPreview(
        workspace_name=name,
        role=invitation.role,
        email=invitation.email,
        expired=_aware(invitation.expires_at) < datetime.now(UTC),
    )


def _aware(value: datetime) -> datetime:
    return value if value.tzinfo is not None else value.replace(tzinfo=UTC)


@router.post("/invitations/{token}/accept")
async def accept_invitation(
    token: str,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict[str, str]:
    invitation = await session.scalar(
        select(WorkspaceInvitation).where(WorkspaceInvitation.token == token)
    )
    if invitation is None:
        raise HTTPException(status_code=404, detail="Invitation not found")
    if _aware(invitation.expires_at) < datetime.now(UTC):
        raise HTTPException(status_code=410, detail="This invitation has expired")

    # The invite is addressed to a person, not to whoever holds the link: the signed-in
    # account's own email must match. Otherwise a leaked link would grant access to anyone.
    signed_in_email = await email_for_user(session, user.id)
    if not signed_in_email or signed_in_email.lower() != invitation.email.lower():
        raise HTTPException(
            status_code=403,
            detail=f"This invitation was sent to {invitation.email}. Sign in as that account.",
        )

    existing = await _role_of(session, user.id, invitation.workspace_id)
    if existing is None:
        session.add(
            Membership(
                id=uuid4(),
                user_id=user.id,
                workspace_id=invitation.workspace_id,
                role=invitation.role,
            )
        )
    # Accepting consumes the invitation either way (idempotent on a double-click).
    await session.execute(
        delete(WorkspaceInvitation).where(WorkspaceInvitation.id == invitation.id)
    )
    await session.commit()

    return {"workspace_id": str(invitation.workspace_id)}
