"""Presence — "who else is looking at this page", over plain polling.

Not a WebSocket, deliberately. Presence here is a low-stakes signal on a single-process API
with no Redis and a hosting story that is boring on purpose (docs/planning/07). A socket would
buy a few seconds of latency and cost three things this codebase would rather not have: the
token in a query string (browsers cannot set an Authorization header on a WS handshake), a
hand-rolled Origin check (CORSMiddleware does not cover WebSocket handshakes), and an
in-memory registry that silently shards the day anyone runs `--workers 2`. Polling reuses the
existing Bearer auth verbatim, degrades to nothing offline like the rest of the app, and stays
correct at any worker count. If it ever needs to push, Postgres LISTEN/NOTIFY is a backplane
we already run.

Tenancy: a heartbeat is only answered for a workspace the caller is a member of, and viewers
are only ever returned within the same (workspace, scope) key — so knowing a page's id tells
you nothing about who is reading it unless you belong to the workspace it lives in.
"""

from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import delete, func, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import CurrentUser, get_current_user
from app.auth_users import emails_for
from app.db import get_session
from app.models.core import Membership, Presence
from app.schemas.presence import PresenceHeartbeat, PresenceState, Viewer

router = APIRouter(prefix="/presence", tags=["presence"])

# How long a heartbeat vouches for someone. Must comfortably exceed the slowest poll below, or
# a person sitting alone would expire between their own heartbeats and be invisible to the next
# arrival until they polled again.
TTL_SECONDS = 25
# Alone is the overwhelmingly common case, so it is the cheap one. The quicker cadence only
# applies once there is actually someone to watch arrive and leave.
POLL_ALONE_MS = 10_000
POLL_TOGETHER_MS = 4_000


def _cutoff() -> Any:
    """The moment before which a heartbeat no longer vouches for anyone — in DB time."""
    # TTL_SECONDS is an int constant defined above, never client input.
    return func.now() - text(f"interval '{TTL_SECONDS} seconds'")


async def _assert_member(session: AsyncSession, user: CurrentUser, workspace_id: UUID) -> None:
    """Any role may see who is here — including viewers, who are reading the same page."""
    role = await session.scalar(
        select(Membership.role).where(
            Membership.user_id == user.id,
            Membership.workspace_id == workspace_id,
        )
    )
    if role is None:
        raise HTTPException(status_code=403, detail="Not a member of this workspace")


@router.post("/heartbeat", response_model=PresenceState)
async def heartbeat(
    payload: PresenceHeartbeat,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> PresenceState:
    """Record that this user is here, and report who else is.

    One row per (workspace, scope, user), so a second tab on the same page refreshes the same
    row rather than doubling the person. A user with two DIFFERENT pages open genuinely appears
    on both — that is true, not a bug — and a page they navigated away from clears by TTL.
    """
    workspace_id = payload.workspace_id
    await _assert_member(session, user, workspace_id)

    # Both the stamp and the cutoff come from the DATABASE clock, never the API host's. They are
    # compared against each other, so a second API host with a skewed clock would otherwise
    # sweep rows that are still live.
    now = func.now()

    # Sweep first, so the read below cannot see a ghost. Global rather than scoped: a page
    # nobody returns to would otherwise keep its rows forever. The table is bounded by active
    # users and `seen_at` is indexed, so this stays cheap.
    await session.execute(delete(Presence).where(Presence.seen_at < _cutoff()))

    stmt = pg_insert(Presence).values(
        workspace_id=workspace_id, scope=payload.scope, user_id=user.id, seen_at=now
    )
    await session.execute(
        stmt.on_conflict_do_update(
            index_elements=[Presence.workspace_id, Presence.scope, Presence.user_id],
            set_={"seen_at": now},
        )
    )

    others = list(
        await session.scalars(
            select(Presence.user_id).where(
                Presence.workspace_id == workspace_id,
                Presence.scope == payload.scope,
                Presence.user_id != user.id,
            )
        )
    )
    await session.commit()

    if not others:
        # The common case: nobody else here, so skip the name lookup entirely and poll lazily.
        return PresenceState(others=[], next_poll_ms=POLL_ALONE_MS)

    # Names live in better-auth's `user` table, which never syncs — so the server resolves them
    # rather than making every client hold a roster just to render two initials.
    profiles = await emails_for(session, others)
    viewers = [
        Viewer(
            user_id=user_id,
            label=(profiles.get(user_id, {}).get("name") or "").strip()
            or profiles.get(user_id, {}).get("email")
            or user_id,
        )
        for user_id in others
    ]
    viewers.sort(key=lambda viewer: viewer.label.lower())
    return PresenceState(others=viewers, next_poll_ms=POLL_TOGETHER_MS)


@router.post("/leave", status_code=204)
async def leave(
    payload: PresenceHeartbeat,
    user: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> None:
    """Best-effort "I've gone" on navigation or tab close.

    Purely a courtesy: a closed laptop never sends this, which is why the TTL is what actually
    makes presence true. It exists so that *deliberate* navigation clears immediately instead of
    leaving a ghost for the better part of half a minute.

    No membership check: this can only ever delete the caller's own row.
    """
    await session.execute(
        delete(Presence).where(
            Presence.workspace_id == payload.workspace_id,
            Presence.scope == payload.scope,
            Presence.user_id == user.id,
        )
    )
    await session.commit()
