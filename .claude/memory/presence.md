# Presence (2026-08-20) — the one ephemeral table

"Who else is reading this page/card", as initials. **This closes Phase 2.**

## Polling, against the industry default — and why that was right here

Every managed presence service is socket-based (Supabase builds theirs on Phoenix Tracker, a
delta-CRDT); the 2026 consensus is that WebSockets superseded polling for this. We polled anyway,
because the same guidance carries the rule *"polling when simplicity or infrastructure
constraints matter more than immediacy"* — and TendTo sits squarely on that side:

- Presence is a low-stakes signal. Supabase's own docs call presence "slow-changing state".
- Cost is not the deciding factor at this size. ~20 tabs polling every 5–10s is ~2–4 req/s, a
  fraction of a core. A single async uvicorn worker also handles ~10k sockets. **Both options
  are free here** — so the decision was made on operational risk, not on load.
- A socket would have cost three concrete things: the token in a query string (browsers cannot
  set an `Authorization` header on a WS handshake, so it lands in access logs), a hand-rolled
  `Origin` check (`CORSMiddleware` does **not** cover WebSocket handshakes — the one unguarded
  entry point), and an in-memory registry that shards silently at `--workers 2`, with no error.
- Polling also degrades to nothing offline, matching how the rest of the app already behaves.

Upgrade path if it ever needs to push: Postgres `LISTEN/NOTIFY`, not Redis — a backplane we
already run, consistent with doc 07's deliberately boring hosting.

## UNLOGGED is a structural guarantee, not an optimisation

The PowerSync publication is `CREATE PUBLICATION powersync FOR ALL TABLES`, so **every new table
is published automatically** — the sync-rules file is the only thing standing between a new table
and a device. An UNLOGGED table writes no WAL, so logical decoding sees nothing and `presence`
**cannot** be replicated even if someone later adds it to the rules by mistake. Also: no WAL cost
for a row rewritten every few seconds, and losing the table in a crash is *correct* — everyone
reappears on their next heartbeat. Pinned by a test reading `pg_class.relpersistence` (note:
asyncpg returns that `"char"` column as bytes, so cast it `::text`).

This is the general lesson worth keeping: with a FOR-ALL-TABLES publication, "don't sync this"
is otherwise only ever a convention. UNLOGGED turns it into physics.

## Design details that took thought

- **Natural key `(workspace_id, scope, user_id)`** — no surrogate id, no TimestampMixin. The
  "client-generated UUID + `updated_at`" invariant governs SYNCED rows; none of it applies.
  One row per person per thing means a second tab does not duplicate you, while genuinely having
  two pages open puts you on both (true, not a bug).
- **TTL 25s, poll 10s alone / 4s in company, server-chosen.** The response carries
  `next_poll_ms`, so cadence is tuned in one place. TTL must exceed the slowest poll or someone
  sitting alone expires between their own heartbeats and is invisible to the next arrival.
- **`leave` uses `fetch(..., {keepalive: true})`**, not `navigator.sendBeacon` — sendBeacon
  cannot carry an Authorization header. It is best-effort courtesy only; a closed laptop never
  sends it, which is why the TTL is what actually makes presence true.
- **Hidden tabs stop polling entirely** and send `leave`. A background tab is not somebody
  reading the page.
- **Tenancy:** heartbeats are refused outside your workspaces, and viewers are only matched
  within the same `(workspace, scope)` — so knowing a page id reveals nothing. Unlike writing,
  *every* role may see who is here, including `viewer`: they are reading the same page.

## The product line

Renders **nothing** when you are alone. Ruled out by name: a workspace-wide "who's online" list,
last-seen, idle/away, and green dots — those report on *people* rather than on the page, which is
the collaboration-noise guardrail. Same distinction comments had to clear ([[comments-and-mentions]]).

This is also the app's **first avatar primitive** — initials in a circle, no image support,
because `Member` has no image field and better-auth profiles are not synced.

## Test trap

Creating two pages back to back: after clicking "New page", the *previous* page's title box is
still mounted for a beat, so `fill` renames the OLD page. Gate on
`expect(getByTestId("page-title")).toHaveValue("Untitled")` first. Same family as the `.last()`
race in [[reminders-and-card-fields]].
