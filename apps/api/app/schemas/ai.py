"""Schemas for the AI endpoints (doc 06)."""

import datetime

from pydantic import BaseModel

# NB: a JSON field is called `date`, which shadows `datetime.date` inside the class body, so
# annotations reference the type via the module (`datetime.date`) rather than a bare `date`.


class DailySummaryRequest(BaseModel):
    """Body for POST /ai/daily-summary. All dates are the USER's local calendar days.

    - nothing / `date`: recap one day (default: today).
    - `start`+`end`: recap a period; omit `start` (with `end` set) for everything so far.
    - `today`: the client's local date — anchors the overdue/upcoming recommendations, since
      the server's UTC "today" can be a day off from where the user actually is.
    """

    date: datetime.date | None = None
    start: datetime.date | None = None
    end: datetime.date | None = None
    today: datetime.date | None = None


class DueItemOut(BaseModel):
    title: str
    due: str  # YYYY-MM-DD (local)


class ActivityOut(BaseModel):
    """The structured digest behind the prose, so the UI can render facts with real styling
    (overdue in red, upcoming in amber) instead of parsing a text blob."""

    focus_minutes: int
    focus_sessions: int
    items_completed: list[str]
    items_created: list[str]
    pages_updated: list[str]
    items_overdue: list[DueItemOut]
    items_due_next: list[DueItemOut]


class DailySummaryResponse(BaseModel):
    start: datetime.date | None  # None = all-time
    end: datetime.date
    summary: str
    # Which engine wrote `summary` ("claude-cli", "api", "offline"). The UI hides the prose
    # when it is "offline" — the fallback text IS the digest, and the digest renders structured.
    engine: str
    activity: ActivityOut
