"""Schemas for shared-workspace collaboration: invites + members."""

from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

# Roles a link may grant. Owner is never invitable by link (transfer/promote is a later,
# deliberate action, not a shareable URL).
INVITABLE_ROLES = ("editor", "viewer")


class CreateWorkspaceRequest(BaseModel):
    name: str = Field(default="Untitled")


class WorkspaceInfo(BaseModel):
    id: UUID
    name: str
    role: str


class CreateInviteRequest(BaseModel):
    workspace_id: UUID
    role: str = Field(default="editor")
    email: str | None = None


class InviteInfo(BaseModel):
    """The invite as returned to its creator (includes the shareable token)."""

    token: str
    workspace_id: UUID
    role: str
    email: str | None
    expires_at: datetime
    accepted_by: str | None


class InvitePreview(BaseModel):
    """What an invitee sees before accepting (no token echoed back)."""

    workspace_id: UUID
    workspace_name: str
    role: str
    valid: bool
    reason: str | None = None  # set when valid is False: "expired" | "accepted" | "not_found"


class AcceptInviteResult(BaseModel):
    workspace_id: UUID
    workspace_name: str
    role: str
    already_member: bool


class MemberInfo(BaseModel):
    user_id: str
    role: str
    name: str | None = None
    email: str | None = None


class MemberList(BaseModel):
    members: list[MemberInfo]
    invites: list[InviteInfo]
