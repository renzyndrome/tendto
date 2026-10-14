"""Schemas for the AI endpoints (doc 06)."""

import datetime

from pydantic import BaseModel, Field

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
    #: Whether the SERVER should write the prose. False when the caller has a local AI engine
    #: (the desktop shell running the user's own CLI) and will write it itself: gathering the
    #: activity needs a membership check and stays here, but the inference does not have to.
    #: The digest comes back either way, so nothing about the response shape changes.
    prose: bool = True


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
    #: The rendered activity digest — exactly the text the server feeds the model. Returned so a
    #: caller with its own engine can write the prose without re-deriving the facts from its
    #: replica. Empty prose plus this is a complete, honest recap on its own.
    digest: str
    # Which engine wrote `summary` ("claude-cli", "api", "offline"). The UI hides the prose
    # when it is "offline" — the fallback text IS the digest, and the digest renders structured.
    engine: str
    activity: ActivityOut


# --- interactive AI (per-page summarize + inline Ask AI) ------------------------------------


class ComposeRequest(BaseModel):
    """Body for POST /ai/compose — one curated task applied to text the user selected."""

    task: str = Field(max_length=64)
    # Bounded well above app.ai.compose.MAX_INPUT_CHARS (which clips at 20k and says so): this
    # is not the working limit, it is the "do not buffer and parse a 500MB body" limit. A hard
    # request-size cap belongs at the proxy; this stops the obvious case.
    text: str = Field(max_length=200_000)
    #: Only for a "search"-scoped task ("Ask my notes"), where `text` carries the sources and
    #: this carries what to ask of them. Required for those, ignored for the editor tasks.
    question: str | None = Field(default=None, max_length=2_000)


class ComposeResponse(BaseModel):
    text: str
    engine: str
    #: True when the input hit MAX_INPUT_CHARS. Surfaced so the UI can say the summary covers
    #: only part of a very long page, rather than quietly lying about it.
    truncated: bool = False


class TaskOut(BaseModel):
    key: str
    label: str
    whole_document: bool
    #: "editor", "search", or "recap" — which surface should offer this task. The editor and the
    #: command palette each filter on their own value, so "recap" appears in neither menu.
    #: See app.ai.compose.Task.
    scope: str
    #: The system prompt. Shipped to the client because a LOCAL engine has to send it itself,
    #: and the prompts must stay owned by the server: they carry the injection rule, which
    #: matters more when the engine is an agentic CLI on someone's own machine, not less.
    #: A second copy in the client is a copy that can be forgotten.
    system: str


class EngineStatus(BaseModel):
    """What the editor asks before offering any AI affordance at all.

    `available` is false on the offline fallback: its "summary" is just the input echoed back,
    which is fine for the recap (where the digest is the real content) and useless here. The
    UI hides the AI entry points entirely rather than showing buttons that cannot work.
    """

    engine: str
    available: bool
    tasks: list[TaskOut]
    #: app.ai.compose.USER_TEXT_MARKER. A local engine assembles its own prompt, and the marker
    #: is half of the injection defence, so it travels with the prompts rather than being
    #: spelled out a second time in the client.
    user_text_marker: str


class AiProviderOut(BaseModel):
    """A provider a user's own key can be used with."""

    key: str
    label: str
    default_model: str


class AiKeySettingsOut(BaseModel):
    """A user's own-key setup, as the settings panel sees it. Never carries the key itself."""

    #: False when the server has no AI_KEYS_SECRET: own keys cannot be stored at all.
    enabled: bool
    #: Whether a custom URL is accepted (AI_ALLOW_CUSTOM_URL).
    custom_allowed: bool
    providers: list[AiProviderOut]
    configured: bool
    provider: str | None = None
    model: str | None = None
    #: Set only for a custom provider.
    base_url: str | None = None
    #: The stored key's last four characters, e.g. "…a1b2".
    key_hint: str | None = None
    #: False when a key is stored but no longer decrypts (the server secret changed).
    key_readable: bool = True


class AiKeySettingsIn(BaseModel):
    provider: str = Field(min_length=1, max_length=32)
    model: str = Field(default="", max_length=200)
    #: Omitted or empty keeps the stored key, so the model can change without retyping it.
    api_key: str | None = Field(default=None, max_length=500)
    base_url: str | None = Field(default=None, max_length=500)
