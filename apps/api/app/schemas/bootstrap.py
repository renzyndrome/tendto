"""Schemas for POST /bootstrap (first-run workspace provisioning)."""

from uuid import UUID

from pydantic import BaseModel


class WorkspaceMembership(BaseModel):
    """One workspace the user belongs to, with their role in it."""

    id: UUID
    name: str
    role: str


class BootstrapResult(BaseModel):
    workspaces: list[WorkspaceMembership]
