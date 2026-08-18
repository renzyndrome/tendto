---
name: ai-engines
description: The three AI engines (CLI/API/fallback), why CLI mode is dev-only, and the containment around shelling out to claude -p
metadata:
  type: project
---

Added 2026-08-18. Renzy asked to power the daily summary with "api or our existing claude or
codex cli".

## Engine order and what each is for

`get_provider()` in `app/ai/provider.py`: **`AI_CLI` > `AI_API_KEY` > offline fallback.**

- **`CliChatProvider`** shells out to `claude -p` (verified headless: piped stdin, non-TTY,
  clean stdout) or `codex exec -` (**unverified** — no codex install existed; revisit the argv
  when one does). Runs on the operator's existing subscription: no key, no per-token bill.
- **`HttpChatProvider` already covered "use the API"** with zero code: it speaks
  OpenAI-compatible `chat/completions`, and Anthropic exposes a compat endpoint at
  `https://api.anthropic.com/v1` — so Anthropic/OpenAI/Ollama are all `.env`-only.
- The fallback keeps dev and the entire test suite network-free, and the e2e recap spec
  depends on its exact output (see below).

## CLI mode is a dev/self-host convenience, NOT a SaaS path

Two reasons, both hard: a personal Claude/ChatGPT subscription serving *other users'* requests
is against the vendors' subscription terms, and the CLI is a real agentic process on the server
host. Containment in `CliChatProvider`, in case user content in the digest tries to steer it:
prompt over **stdin** (argv leaks into `ps` and has length limits), cwd = an **empty scratch
dir** (file-reading tools find nothing), and `--max-turns 1` (no tool-use round trip). Also:
empty stdout is an ERROR, not an empty recap delivered as if real.

**The expected failure mode is PATH.** Under nvm, `claude` is a node script — the server needs
`node` on PATH too, so it works from an interactive shell and fails under a service manager.
The provider resolves the binary eagerly and says so in the error. Start `make dev` from a
shell where `claude -p` works.

## The e2e contract: the stack runs with NO engine

`e2e/recap.spec.ts` asserts the fallback's verbatim digest. If a real engine is configured it
must SKIP — checked with a single probe call **before** the poll loop, because with a real
engine every poll iteration is a billable model call. Don't "fix" that skip into an assertion.

Also: **the recap reads Postgres, not the replica.** A spec that creates an item and immediately
opens the recap sees "a calm day" — the local write hasn't uploaded yet. Gate on the endpoint
itself naming the row (that's the upload landing), not on any UI rendered from the replica.

## Recommendations are digest-driven, not model-driven

"Tomorrow recommends what to tend to" works by feeding the digest overdue + next-two-days items
(each "Title (date)", ≤10 per section so a backlog can't flood the prompt, `done` never nagged,
membership-scoped like everything else). The model is told to never invent tasks not listed —
and the no-key fallback simply prints the same sections, so recommendations exist offline too.
Due comparisons are lexicographic on the first 10 chars of `properties.due` (works for both
stored shapes; see [[reminders-and-card-fields]]).

The summary prompt now demands **plain text, no markdown** — the recap view renders
`whitespace-pre-wrap` text, and fallback/CLI/API outputs should look the same.

## The response is structured, and the UI treats prose as optional

`POST /ai/daily-summary` returns `{start, end, summary, engine, activity}` — the structured
digest rides along so the UI styles facts (overdue rows in `danger`, upcoming in `warn`, stat
chips) instead of parsing a text blob. When `engine == "offline"` the prose is HIDDEN: the
fallback text IS the digest, so showing both would duplicate. The `warn` token was added for
this (light `180 83 9`, dark `251 191 36`) — the palette's first non-danger hue; keep using the
token, never a raw amber class.

Periods: the endpoint takes `{start?, end?, date?, today?}` — a day, a range (`start` omitted =
all time), and `today` = the CLIENT's local date anchoring recommendations. The UI's periods
(Day/Week/Month/All) are calendar-aligned (Sunday weeks, like the app) and ride a `?period=`
search param on `/recap/$date`. Recommendations are anchored on NOW regardless of period — what
needs tending is true whichever slice of the past you're reading, and it keeps past days from
claiming "a calm day" over a missed deadline.

## The API never read .env at all (fixed 2026-08-18)

When Renzy set `AI_CLI=claude` and nothing changed, the cause wasn't the AI code: pydantic's
`env_file=".env"` resolves against the process CWD, and uvicorn is started with `cd apps/api`
(scripts/e2e-stack.sh) — so the API had been reading the nonexistent `apps/api/.env` and
running on Settings **defaults** since the beginning. Nobody noticed because every default
matches the dev ports exactly. `config.py` now locates the repo-root `.env` from `__file__`;
real env vars still take precedence, and a missing file (prod containers) is ignored.

**Dotenv inline-comment trap (bit us the same day):** python-dotenv strips an inline `# comment`
only when a VALUE precedes it — on an empty-value line (`AI_API_KEY=   # leave empty`) the
comment string BECOMES the value. Symptom: `get_provider()` chose the HTTP engine with
`base_url` set to a comment → `httpx.UnsupportedProtocol: Request URL is missing an 'http://'
protocol`. Both `.env` and `.env.example` now keep comments on their own lines for empty-value
keys; never add an inline comment after a bare `KEY=`.

Two knock-on effects worth knowing:
- Anything .env-only was silently inert before this — e.g. an `EMAIL_API_KEY` set there would
  never have sent an email.
- Now that the suite CAN see the dev .env, `app/tests/__init__.py` forces `AI_CLI`/`AI_API_KEY`
  empty (it runs before conftest's imports, which matters: `app.db` builds its engine at import
  time). Otherwise every endpoint test would shell out to the real CLI. Keep that file.

Also: settings load ONCE (`lru_cache`) — editing .env always needs an API restart. And with
`AI_CLI` enabled in dev, `e2e/recap.spec.ts` deliberately SKIPS its content assertions (real
engine = billable + nondeterministic); blank `AI_CLI` temporarily for full e2e coverage.

## Two traps from this pass

- **Editing tailwind.config.js requires restarting Vite.** Playwright reuses a running dev
  server (`reuseExistingServer`), so a new token silently generates NO css — the symptom is a
  class like `text-warn` rendering unstyled while everything else works. Kill vite; the next
  test run restarts it.
- **`.last()` races freshly-mounted rows.** Clicking "+ New item" then filling
  `getByPlaceholder(...).last()` can resolve against the OLD DOM and silently edit the previous
  row (two "identical" rows in Postgres, one empty). Gate on
  `expect(rows).toHaveCount(n + 1)` before targeting `.last()`.

## Session cache in the recap view

`daily-recap.tsx` caches responses per date for the session: past days are immutable so cached
is authoritative; **today** refetches on each mount (the day grows), using the cache only as an
instant preview. Browsing back and forth must not re-bill the model or the CLI subscription.
