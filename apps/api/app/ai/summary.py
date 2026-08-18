"""Daily-summary service — TendTo's one ambient AI feature (doc 06 AI-1, CLAUDE.md guardrails).

A plain read of the source of truth (Postgres) becomes a compact activity digest, which a
`ChatProvider` turns into a calm recap. All activity is scoped to the workspaces the user is a
member of via `memberships` — the same tenancy boundary the sync path enforces.
"""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ChatProvider, get_provider
from app.models.core import FocusSession, Item, Membership, Page

DAILY_SUMMARY_SYSTEM = (
    "You are TendTo's calm daily assistant. Turn the user's activity log — one day or a "
    "longer period — into a short, encouraging recap with three brief sections — Wins, "
    "Open items, and Next. When the log lists overdue or upcoming tasks, Next should "
    "recommend which to tend to first, by name. Be specific and concise; never invent "
    "activity or tasks that are not listed, and never scold — an empty day is fine. Write "
    "PLAIN TEXT only: section names on their own line, short lines under them, no markdown."
)


@dataclass(frozen=True)
class DueItem:
    """A task the recap should point at: its title and the LOCAL day it falls due."""

    title: str
    due: str  # YYYY-MM-DD

    def render(self) -> str:
        return f"{self.title} ({self.due})"


@dataclass(frozen=True)
class DailyActivity:
    """A user's tracked activity for a period (one day, a week, a month, or everything),
    scoped to their workspaces.

    Content activity is bucketed by UTC day; focus sessions are bucketed by the user's own
    LOCAL day, which they carry explicitly (see FocusSession.local_date) because the server
    never learns the device's timezone. `start` is None for an all-time recap.
    """

    start: date | None
    end: date
    pages_updated: tuple[str, ...]
    items_created: tuple[str, ...]
    items_completed: tuple[str, ...]
    focus_minutes: int = 0
    focus_sessions: int = 0
    # The forward-looking half: what "Next" should recommend. Anchored on TODAY regardless of
    # the period — what needs tending now is true whichever slice of the past you're reading.
    items_overdue: tuple[DueItem, ...] = ()
    items_due_next: tuple[DueItem, ...] = ()

    @property
    def is_empty(self) -> bool:
        """No activity happened in the period. Due/overdue items are deliberately not counted —
        they describe the future, and an idle day with a deadline coming still needs a recap."""
        return not (
            self.pages_updated or self.items_created or self.items_completed or self.focus_sessions
        )


def render_activity(activity: DailyActivity) -> str:
    """Pure, deterministic activity digest. Feeds both the model prompt (the `user` message)
    and the offline FallbackProvider, so the summary is consistent with or without a model."""
    lines = [_header(activity)]
    has_recommendations = bool(activity.items_overdue or activity.items_due_next)
    if activity.is_empty and not has_recommendations:
        lines.append("No tracked activity — a calm day.")
        return "\n".join(lines)
    if activity.is_empty:
        # Nothing happened, but something is due — the recommendation half still matters.
        lines.append("No tracked activity in this period.")
    if activity.focus_sessions:
        lines.append(_focus_line(activity.focus_minutes, activity.focus_sessions))
    if activity.items_completed:
        lines.append(_section("Tasks completed", activity.items_completed))
    if activity.items_created:
        lines.append(_section("Tasks added", activity.items_created))
    if activity.pages_updated:
        lines.append(_section("Pages updated", activity.pages_updated))
    if activity.items_overdue:
        lines.append(_section("Overdue", tuple(d.render() for d in activity.items_overdue)))
    if activity.items_due_next:
        lines.append(
            _section("Due in the next two days", tuple(d.render() for d in activity.items_due_next))
        )
    return "\n".join(lines)


def _header(activity: DailyActivity) -> str:
    if activity.start is None:
        return f"All tracked activity through {activity.end.isoformat()}:"
    if activity.start == activity.end:
        return f"Activity for {activity.end.isoformat()}:"
    return f"Activity for {activity.start.isoformat()} to {activity.end.isoformat()}:"


def _section(label: str, names: tuple[str, ...]) -> str:
    return f"{label} ({len(names)}): {', '.join(names)}"


def _focus_line(minutes: int, sessions: int) -> str:
    hours, rest = divmod(minutes, 60)
    spent = f"{hours}h {rest}m" if hours else f"{rest}m"
    return f"Focused time: {spent} across {sessions} {'session' if sessions == 1 else 'sessions'}"


def _utc_range_bounds(start: date | None, end: date) -> tuple[datetime | None, datetime]:
    """[start 00:00, end+1 00:00) in UTC — the window the content queries use. A None start
    means "since forever" (the all-time recap)."""
    lower = None if start is None else datetime(start.year, start.month, start.day, tzinfo=UTC)
    upper = datetime(end.year, end.month, end.day, tzinfo=UTC) + timedelta(days=1)
    return lower, upper


def _item_title(properties: object) -> str:
    """A display title from an item's JSONB properties (robust to dict or JSON-string form)."""
    if isinstance(properties, str):
        try:
            properties = json.loads(properties)
        except (ValueError, TypeError):
            return "Untitled task"
    if isinstance(properties, dict):
        title = properties.get("title")
        if isinstance(title, str) and title.strip():
            return title.strip()
    return "Untitled task"


async def gather_activity(
    session: AsyncSession,
    user_id: str,
    start: date | None,
    end: date,
    *,
    today: date | None = None,
) -> DailyActivity:
    """Query the period's activity across every workspace the user is a member of.

    Three content reads, all joined to `memberships` so a user never sees another tenant's
    activity:
    - pages whose `updated_at` falls in the UTC window,
    - items whose `created_at` falls in the UTC window (added),
    - items with `properties->>'status' = 'done'` whose `updated_at` falls in the UTC window
      (completed).

    Plus a fourth read of the user's own focus sessions, which are user-owned rather than
    workspace-scoped and so need no join at all — and two forward-looking reads (overdue and
    due-soon items, anchored on `today`) so the recap can *recommend* rather than only recount.

    `today` is the CLIENT's local date when it sends one — the server's UTC "today" can be a
    day off from where the user actually is. Every list is bounded: this feeds a prompt, and a
    month of heavy activity (or an ancient backlog) shouldn't flood it.
    """
    lower, upper = _utc_range_bounds(start, end)
    anchor = today or datetime.now(UTC).date()

    def _in_window(column: Any) -> list[Any]:
        conditions = [column < upper]
        if lower is not None:
            conditions.append(column >= lower)
        return conditions

    page_titles = (
        await session.scalars(
            select(Page.title)
            .join(Membership, Membership.workspace_id == Page.workspace_id)
            .where(Membership.user_id == user_id, *_in_window(Page.updated_at))
            .order_by(Page.updated_at)
            .limit(25)
        )
    ).all()

    created = (
        await session.scalars(
            select(Item.properties)
            .join(Membership, Membership.workspace_id == Item.workspace_id)
            .where(Membership.user_id == user_id, *_in_window(Item.created_at))
            .order_by(Item.created_at)
            .limit(25)
        )
    ).all()

    completed = (
        await session.scalars(
            select(Item.properties)
            .join(Membership, Membership.workspace_id == Item.workspace_id)
            .where(
                Membership.user_id == user_id,
                Item.properties["status"].astext == "done",
                *_in_window(Item.updated_at),
            )
            .order_by(Item.updated_at)
            .limit(25)
        )
    ).all()

    # Focus sessions need no membership join: they are user-owned, not workspace content. They
    # are also matched on the user's OWN local days rather than the UTC window above — the row
    # carries `local_date` precisely so an evening session isn't filed under tomorrow.
    focus_where = [FocusSession.user_id == user_id, FocusSession.local_date <= end.isoformat()]
    if start is not None:
        focus_where.append(FocusSession.local_date >= start.isoformat())
    focus = (
        await session.execute(
            select(
                func.coalesce(func.sum(FocusSession.minutes), 0),
                func.count(FocusSession.id),
            ).where(*focus_where)
        )
    ).one()

    # The forward-looking half. `due` is "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM" (lib/items/due.ts),
    # so the first 10 chars are the LOCAL day it falls on and compare lexicographically.
    # Bounded to 10 each: this feeds a prompt, and an ancient backlog shouldn't flood it.
    due_day = func.substr(Item.properties["due"].astext, 1, 10)
    not_done = func.coalesce(Item.properties["status"].astext, "") != "done"
    has_due = func.coalesce(Item.properties["due"].astext, "") != ""

    async def _due_between(due_lower: str | None, due_upper: str) -> tuple[DueItem, ...]:
        rows = (
            await session.execute(
                select(Item.properties, due_day)
                .join(Membership, Membership.workspace_id == Item.workspace_id)
                .where(
                    Membership.user_id == user_id,
                    has_due,
                    not_done,
                    *([due_day >= due_lower] if due_lower is not None else []),
                    due_day < due_upper,
                )
                .order_by(due_day)
                .limit(10)
            )
        ).all()
        return tuple(DueItem(title=_item_title(props), due=due) for props, due in rows)

    anchor_key = anchor.isoformat()
    overdue = await _due_between(None, anchor_key)
    due_next = await _due_between(anchor_key, (anchor + timedelta(days=2)).isoformat())

    return DailyActivity(
        start=start,
        end=end,
        pages_updated=tuple(title or "Untitled page" for title in page_titles),
        items_created=tuple(_item_title(props) for props in created),
        items_completed=tuple(_item_title(props) for props in completed),
        focus_minutes=int(focus[0] or 0),
        focus_sessions=int(focus[1] or 0),
        items_overdue=overdue,
        items_due_next=due_next,
    )


async def summarize(activity: DailyActivity, provider: ChatProvider | None = None) -> str:
    """Turn a gathered activity digest into a calm recap via the provider.

    `provider` is optional: the ambient job and direct callers fall back to the configured
    default (`get_provider()`), while the endpoint injects the FastAPI-resolved provider so
    tests can override it without touching the network.
    """
    provider = provider or get_provider()
    return await provider.complete(DAILY_SUMMARY_SYSTEM, render_activity(activity))


async def build_daily_summary(
    session: AsyncSession,
    user_id: str,
    day: date,
    provider: ChatProvider | None = None,
) -> str:
    """One day's recap, recommendations anchored on that same day. The ambient job's (and the
    original tests') entry point; the endpoint composes gather/summarize itself because it also
    returns the structured activity."""
    activity = await gather_activity(session, user_id, day, day, today=day)
    return await summarize(activity, provider)
