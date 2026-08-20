"""Presence wire types.

`scope` is validated by pattern rather than trusted: it is a client-supplied string that
becomes a lookup key, so constraining it to the two shapes the app actually uses keeps junk out
of the table and keeps the key space from being used as scratch storage.
"""

from uuid import UUID

from pydantic import BaseModel, Field, field_validator

# "page:<uuid>" or "item:<uuid>". Matches models.core.Presence.scope's String(64).
SCOPE_PATTERN = (
    r"^(page|item):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$"
)


class PresenceHeartbeat(BaseModel):
    workspace_id: UUID
    scope: str = Field(pattern=SCOPE_PATTERN)

    @field_validator("scope")
    @classmethod
    def _normalize(cls, scope: str) -> str:
        """Case-fold the scope so one page is one room.

        The pattern accepts either case (a UUID is not case-sensitive), but the scope is a raw
        lookup key — two clients spelling the same id differently would sit in separate rooms
        and never see each other.
        """
        return scope.lower()


class Viewer(BaseModel):
    user_id: str
    label: str


class PresenceState(BaseModel):
    """Who ELSE is here. The caller is never included — you know where you are."""

    others: list[Viewer]
    # The server sets the client's next poll delay, so the cadence can be tuned in one place:
    # slower when nobody is around (the overwhelmingly common case), quicker in company.
    next_poll_ms: int
