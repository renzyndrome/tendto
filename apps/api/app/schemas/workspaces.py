"""Schemas for POST /workspaces (creating an additional workspace)."""

from uuid import UUID

from pydantic import BaseModel, Field


class CreateWorkspaceRequest(BaseModel):
    """The id is optional but client-generated when present (CLAUDE.md invariant 3), which is
    what makes the endpoint safely replayable from an offline queue."""

    id: UUID | None = None
    name: str = Field(default="New Workspace", max_length=200)
