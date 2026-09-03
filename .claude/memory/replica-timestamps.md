---
name: replica-timestamps
description: A row's updated_at text is NOT stable across the sync round-trip — compare instants, never strings; plus the midnight-boundary trap in time-of-day tests
metadata:
  type: project
---

Two time-shaped traps, both found the hard way while building the "updated elsewhere" notice
([[current-state]]).

## `updated_at` changes its spelling, not its meaning

A local write stores what JavaScript wrote:

    2026-09-03T15:55:42.276Z      (Date#toISOString)

The same row, once FastAPI has stored it and PowerSync has replicated it back down, reads as
Postgres renders `timestamptz`:

    2026-09-03 15:55:42.276+00    (space, no "T"; "+00", not "Z")

**Same instant. Different string.** The server keeps the client's edit time (`_incoming_updated_at`
in `sync.py`), so nothing is lost — only the formatting changes, and only after the round-trip
completes, which is a second or two *after* the local write.

Anything that compares `updated_at` by string equality therefore works locally and then breaks
a moment later, and only for rows that have been uploaded. The "updated elsewhere" watcher hit
exactly this: every one of the user's own saves began to look like another device's edit once
the round-trip landed. The fix is `toInstant()` in `lib/blocks/self-writes.ts` — normalize to
epoch milliseconds and compare numbers.

**Rule: never compare a replica timestamp as text.** Parse it. And note that a value read from
the replica may be in EITHER format depending on whether that row has been up and back yet, so
a parser has to accept both.

## Time-of-day logic needs tests that cannot cross midnight

Two E2E specs failed only when the suite ran near midnight, for the same underlying reason:
an offset from "now" silently lands on a different **day**, and the code compares time of day.

- `recap-schedule.spec.ts` computed "two hours from now" as a delivery hour. Run at 23:46 that
  is `01:46`, which the app correctly reads as *already past* — so the recap fired in the test
  that asserts it stays quiet. **Fixed**: `scheduleAt` now clamps the seeded time inside today.
- `focus.spec.ts` (`a finished session is recorded and survives a reload`) seeds a work phase
  that ended one second ago, i.e. **started 25 minutes ago**. A focus session files under the
  day it started (`local_date = toDateKey(startedAt)` in `lib/focus/sessions.ts`), so a run in
  the first ~25 minutes after midnight files the session under yesterday while the "Today" stat
  reads today. The app is right; the test's assumption is what breaks. **Fixed**: the test pins
  the date with `page.clock.setFixedTime(midday)`. `setFixedTime` freezes `Date.now()` only —
  timers keep running, so the app behaves normally and only the calendar day is controlled.

If a spec seeds a time relative to `Date.now()` and the feature compares dates or hours, ask
what happens when the run straddles midnight. It will, eventually.
