"""Daily-summary service — TendTo's one ambient AI feature (doc 06 AI-1, CLAUDE.md guardrails).

A plain read of the source of truth (Postgres) becomes a compact activity digest, which a
`ChatProvider` turns into a calm recap. All activity is scoped to the workspaces the user is a
member of via `memberships` — the same tenancy boundary the sync path enforces.
"""

import json
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.ai.provider import ChatProvider, get_provider
from app.models.core import Item, Membership, Page

DAILY_SUMMARY_SYSTEM = (
    "You are TendTo's calm daily assistant. Turn the user's activity log into a short, "
    "encouraging end-of-day recap with three brief sections — Wins, Open items, and "
    "Tomorrow. Be specific and concise; never invent activity that is not listed."
)


@dataclass(frozen=True)
class DailyActivity:
    """A user's tracked activity for one UTC day, scoped to their workspaces."""

    day: date
    pages_updated: tuple[str, ...]
    items_created: tuple[str, ...]
    items_completed: tuple[str, ...]

    @property
    def is_empty(self) -> bool:
        return not (self.pages_updated or self.items_created or self.items_completed)


def render_activity(activity: DailyActivity) -> str:
    """Pure, deterministic activity digest. Feeds both the model prompt (the `user` message)
    and the offline FallbackProvider, so the summary is consistent with or without a model."""
    lines = [f"Activity for {activity.day.isoformat()}:"]
    if activity.is_empty:
        lines.append("No tracked activity — a calm day.")
        return "\n".join(lines)
    if activity.items_completed:
        lines.append(_section("Tasks completed", activity.items_completed))
    if activity.items_created:
        lines.append(_section("Tasks added", activity.items_created))
    if activity.pages_updated:
        lines.append(_section("Pages updated", activity.pages_updated))
    return "\n".join(lines)


def _section(label: str, names: tuple[str, ...]) -> str:
    return f"{label} ({len(names)}): {', '.join(names)}"


def _utc_day_bounds(day: date) -> tuple[datetime, datetime]:
    """[start, end) for the given calendar day in UTC — the day boundary the queries use."""
    start = datetime(day.year, day.month, day.day, tzinfo=UTC)
    return start, start + timedelta(days=1)


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


async def gather_activity(session: AsyncSession, user_id: str, day: date) -> DailyActivity:
    """Query the day's activity across every workspace the user is a member of.

    Three reads, all joined to `memberships` so a user never sees another tenant's activity:
    - pages whose `updated_at` falls in the UTC day,
    - items whose `created_at` falls in the UTC day (added today),
    - items with `properties->>'status' = 'done'` whose `updated_at` falls in the UTC day
      (completed today).
    """
    start, end = _utc_day_bounds(day)

    page_titles = (
        await session.scalars(
            select(Page.title)
            .join(Membership, Membership.workspace_id == Page.workspace_id)
            .where(
                Membership.user_id == user_id,
                Page.updated_at >= start,
                Page.updated_at < end,
            )
            .order_by(Page.updated_at)
        )
    ).all()

    created = (
        await session.scalars(
            select(Item.properties)
            .join(Membership, Membership.workspace_id == Item.workspace_id)
            .where(
                Membership.user_id == user_id,
                Item.created_at >= start,
                Item.created_at < end,
            )
            .order_by(Item.created_at)
        )
    ).all()

    completed = (
        await session.scalars(
            select(Item.properties)
            .join(Membership, Membership.workspace_id == Item.workspace_id)
            .where(
                Membership.user_id == user_id,
                Item.updated_at >= start,
                Item.updated_at < end,
                Item.properties["status"].astext == "done",
            )
            .order_by(Item.updated_at)
        )
    ).all()

    return DailyActivity(
        day=day,
        pages_updated=tuple(title or "Untitled page" for title in page_titles),
        items_created=tuple(_item_title(props) for props in created),
        items_completed=tuple(_item_title(props) for props in completed),
    )


async def build_daily_summary(
    session: AsyncSession,
    user_id: str,
    day: date,
    provider: ChatProvider | None = None,
) -> str:
    """Gather the day's activity and turn it into a calm recap via the provider.

    `provider` is optional: the ambient job and direct callers fall back to the configured
    default (`get_provider()`), while the endpoint injects the FastAPI-resolved provider so
    tests can override it without touching the network.
    """
    provider = provider or get_provider()
    activity = await gather_activity(session, user_id, day)
    user_prompt = render_activity(activity)
    return await provider.complete(DAILY_SUMMARY_SYSTEM, user_prompt)
