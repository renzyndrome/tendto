"""Schemas for workspace members and invitations."""

import re
from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# owner = full control incl. members + deletion; editor = can write; viewer = read-only.
ROLES = ("owner", "editor", "viewer")

# Deliberately a syntax check, NOT pydantic's EmailStr. EmailStr rejects RFC 2606 special-use
# domains (.test, .invalid) and would also refuse the internal TLDs a self-hosted deployment
# may legitimately use (.internal, .local, bare intranet hosts). Delivery is the mail
# provider's problem; our job is to reject obvious garbage.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class Member(BaseModel):
    user_id: str
    email: str | None = None
    name: str | None = None
    role: str
    is_you: bool = False


class Invitation(BaseModel):
    id: UUID
    email: str
    role: str
    expires_at: datetime


class WorkspaceMembers(BaseModel):
    members: list[Member]
    invitations: list[Invitation]
    your_role: str


class InviteRequest(BaseModel):
    email: str = Field(max_length=320)
    role: str = Field(default="editor")

    @field_validator("email")
    @classmethod
    def _check_email(cls, value: str) -> str:
        candidate = value.strip().lower()
        if not _EMAIL_RE.match(candidate):
            raise ValueError("Enter a valid email address")
        return candidate


class InviteResult(BaseModel):
    invitation: Invitation
    # The link is returned so the UI can offer "copy link" — essential when no email provider
    # is configured (dev), and a useful fallback when delivery fails.
    invite_url: str
    email_delivered: bool
    detail: str = ""


class RoleUpdate(BaseModel):
    role: str


class InvitationPreview(BaseModel):
    """Unauthenticated-safe view of an invite, for the accept screen."""

    workspace_name: str
    role: str
    email: str
    expired: bool
