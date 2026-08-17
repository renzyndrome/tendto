---
name: calendar-day-view
description: Why the day view treats items as deadlines not meetings, and the Google behaviours that were deliberately dropped
metadata:
  type: project
---

Added 2026-08-17. Renzy asked for "a day view based so we can plot the task for that day if i
clicked that specific day in the calendar… look into google calendar so you can mimic how it
behave".

## An item is a DEADLINE, not a meeting — that shapes the whole grid

Google's day view draws an event as a block spanning `start → end`. TendTo items have a due
*moment* and no duration (`lib/items/due.ts`), so a block is drawn exactly one slot
(`SLOT_MINUTES`) tall as a readable anchor — never as a claim about how long the work takes.
Everything downstream follows from that:

- **The all-day row means "due that day, whenever"**, which is what a date-only `due` already
  meant. Dropping a task there clears its time; dragging one out onto the grid sets one. No new
  field, no migration — the all-day row IS the "no time" branch of `parseDue`.
- **Overlap layout groups by real interval collision** (`layoutByTime` in `lib/calendar.ts`), not
  by slot bucket, because a time typed as 09:10 straddles the 09:00 and 09:30 buckets. Grouping
  into clusters first is what keeps a lone task full width instead of narrowing every task on the
  day to match the busiest moment.
- **Adding duration would be the moment to stop and think.** It turns a task list into a
  scheduler, and every "does this add clutter?" answer after that gets harder.

## The quick-create bubble needs one control Google doesn't

Clicking an empty slot opens Google's quick-create bubble: title, time, save. Ours adds a
**collection picker**, because an item must belong to a collection — guessing silently would drop
tasks into the wrong one, and the wrong collection is invisible from the calendar. It defaults to
the first collection and remembers nothing, which is deliberate: the list is short and a
remembered default that goes stale is worse than one you can see.

## Google behaviours deliberately NOT copied

- **Week view / year view / mini-month.** Month + day covers "what's this month" and "what's
  today"; a week view is a third layout to maintain for a narrow gap between them.
- **Multi-day drag, resize handles, duration.** See above — items have no duration.
- **Per-calendar colours.** The palette is monochrome by design (`--c-accent` is near-black in
  light, near-white in dark); board columns are the one place colour carries meaning. A block gets
  an accent left rail instead, which is what stops a short full-width block reading as a divider
  line.
- **Search/keyboard shortcuts (d/w/m/t).** Cmd-K search already exists; view shortcuts are muscle
  memory for a tool people live in all day, which this is not yet.

## Wiring notes

- **The day is a ROUTE** — `/calendar/$date`, a local `YYYY-MM-DD` — for the same reasons the card
  dialog is one: linkable, Back returns to the month, a reload stays put. Parse it with
  `parseDateKey`, never `new Date(key)`, which is UTC and lands you on the previous day west of
  Greenwich.
- **Month chips now open the CARD** (`/c/$id/i/$itemId`) rather than the collection; the cell
  behind them opens the day. Chips `stopPropagation` so the cell click doesn't swallow them, and
  the date number is a real button — the middle of a busy cell is a chip, which matters for tests.
- **The drag payload rides in `dataTransfer`**, not component state, so the grid and the all-day
  row can both read the dragged id without knowing what's being dragged. The drop keeps the grab
  offset (where inside the block you grabbed it), or every drop snaps the block's top to the
  cursor and lands half a slot late.
- Verified in **Firefox** as well as Chromium (the e2e suite is Chromium-only — see
  [[reminders-and-card-fields]] for why that gap bit us before). The board's existing DnD was
  checked at the same time and is fine in Firefox; the missing `setData` there is not a bug.

## E2E trap: "New collection" navigates, and it will navigate over you

`New collection` creates the row and then routes to it. A spec that clicks it and immediately
clicks somewhere else (the sidebar's Calendar, say) gets thrown back to the collection when the
navigation lands — the symptom is a missing `cal-day-*` cell and a screenshot showing the board.
Gate on `await expect(page).toHaveURL(/\/c\//)` first. Same shape as the un-awaited-write races in
[[reminders-and-card-fields]].
