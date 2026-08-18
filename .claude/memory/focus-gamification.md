---
name: focus-gamification
description: Why focus stats are reflective (no XP/streaks), and the first user-private sync bucket the history needed
metadata:
  type: project
---

Added 2026-08-18. Renzy asked how to gamify focus mode and asked for research into how other apps
do it. The research changed the answer, so it is worth keeping.

## What the research ruled out, and why we still shipped a garden

- **Forest works by LOSS** — leave the app and your tree dies. That is exactly the mechanic the
  literature ties to guilt, streak anxiety and dependency. We kept the cultivation metaphor and
  removed the punishment: **nothing in the garden ever dies or is taken away**, a day you didn't
  focus is bare soil rather than a stump, and past growth lives in the heatmap where it can't be
  destroyed. The product is called TendTo; a thing you tend, that waits for you, is the on-brand
  version.
- **The overjustification effect**: piling extrinsic rewards onto something you already want to do
  reduces intrinsic motivation. So no XP, levels, coins or badge cabinet — those were explicitly
  offered and explicitly declined.
- **The red-flag test we adopted**: *if a metric can be maximised without actually focusing more,
  don't gamify it.* That is why growth tracks a day's TOTAL MINUTES, never session count (which
  you could farm by starting timers), and why nothing counts app opens or time-with-tab-focused.
- **No streak counter.** A number that resets to zero on one missed day turns the tool into a
  debt. "Days focused this week" carries the same signal with no cliff. If a streak is ever added
  it needs freezes/rest days — that is the baseline expectation now, not a premium feature.
- Heatmap intensity uses **fixed thresholds, not relative-to-your-best**: a scale that rescales
  itself means a good day visibly *dims* when a later day beats it, which reads as losing
  progress you already earned.

## `focus_sessions` is the first USER-PRIVATE synced table

Focus history has to sync (so it survives a device change and the daily summary can see it), but
it must never be workspace-scoped. `workspace_content` ships **every row of a workspace to every
member**, so a `workspace_id` on this table would put your Pomodoro history on your teammates'
devices — and once a row reaches a device it is on that device. That is a leak, not a preference,
and it is a **one-way door**.

So there is now a second bucket, `user_private`, keyed on `request.user_id()` with a parameter
query that reads no table at all. Consequences worth knowing:

- **`sync.py` grew a second authorization model.** `USER_OWNED_TABLES` branches to
  `_assert_owns_row`, which checks the row against the token subject instead of `memberships`.
  The old "pin the tenant column so a client can't relocate a row" logic generalised into an
  `OwnerPin(column, value)` — workspace tables pin `workspace_id`, user tables pin `user_id`.
  Workspace behaviour is unchanged, including the `owner.column in table.c` guard that keeps
  `workspaces` (which pins by row id and has no such column) working.
- **A client-supplied `user_id` is ignored outright** for a new row rather than validated: the
  writer is the owner by definition, so there is no legitimate value but the token subject.
- **CLAUDE.md invariant 6 and the `sync-rules` skill both said "every table needs
  `workspace_id`"**, which would have led the next person to put this table in the leaking
  bucket. Both are amended; the skill now opens with "step 0 — which bucket?". Treat that as part
  of the security fix, not documentation tidying.
- No RLS was added because the project has **none at all** — it is documented in doc 05 as
  layer 3 but unbuilt. When that pass happens, this is the first table whose predicate keys on
  `user_id` rather than `workspace_id`.

## `started_at` was the first client-supplied timestamp column — and it 500s without a parse

`_row_values` binds client data raw. Every prior column was text/int/JSON; `updated_at` is parsed
separately and `created_at` is reserved, so **no client string had ever reached a `timestamptz`
before**. asyncpg refuses one:

```
DataError: invalid input for query argument $3: '2026-08-18T09:00:00+00:00'
(expected a datetime.date or datetime.datetime instance, got 'str')
```

Verified by disabling the parse and watching the test fail. That 500 is nastier than it looks:
the client's `uploadData` re-throws without completing the transaction and the queue is ORDERED,
so one bad entry wedges **every subsequent write from that device**, permanently — recovery means
`disconnectAndClearDb()`, i.e. data loss. Hence `DATETIME_COLUMNS` in `sync.py` and a test of its
own. Same class of trap: `sa.Date` also rejects a `'YYYY-MM-DD'` string, which is why `local_date`
is `String(10)` rather than a date column.

## `local_date` is stored, not derived

The server never learns the device's timezone, so it cannot recover the user's day from
`started_at` — a 9pm session in UTC+8 would file under tomorrow. The client writes the local day
with `toDateKey`, the same helper the calendar uses, and the daily summary matches on it directly
instead of the UTC window it uses for pages/items. *(Those three content queries still have the
UTC skew; noted, not fixed.)*

## Traps hit while building

- **Recording is inside the EXISTING phase-completion effect**, after `handled.current` is set and
  before `completePhase()` (which nulls `endsAt`, needed to derive the start instant). A second
  effect would reintroduce the StrictMode double-fire from [[pomodoro-phases]] — and here it would
  double-record, silently doubling every stat.
- **A stale `uvicorn` will 400 the new table.** `scripts/e2e-stack.sh` starts the API without
  `--reload`, so after adding to `TABLE_MODELS` you must restart it or every upload returns
  "Unknown table" — which looks exactly like a sync bug.
- **Changing sync-rules.yaml makes PowerSync reprocess every bucket.** Cross-workspace e2e
  assertions with a 15s timeout failed for a few runs afterwards and then passed unchanged. If a
  sync-timing test starts failing right after a rules edit, wait before debugging the code.
- The publication is `FOR ALL TABLES` (`select tablename from pg_publication_tables where
  pubname='powersync'` to confirm), so a new table replicates with no extra step. On a machine
  where it was created for an explicit list it silently would not — and the symptom is deceptive:
  uploads succeed, rows never come back down.
