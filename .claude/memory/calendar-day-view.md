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

## The quick-create bubble asks for a collection only when there IS a choice

Clicking an empty slot opens Google's quick-create bubble: title, time, save. Ours can also need a
**collection picker**, because `items.collection_id` is required — with two or more collections a
silent guess buries the task somewhere you won't look. With one collection (or none) the question
has a single answer, so the picker is hidden: Renzy hit a lone dropdown reading "Untitled" (the
default name from `createCollection`) and reasonably asked what it even was. When shown it is
labelled `in ___`, so the row reads "05:00 PM in Marketing" rather than a bare mystery value.

**There is still no separate workspace control** even now that the calendar spans workspaces (see
below): choosing the collection already chooses the workspace, so a second control could only
contradict the first. The options are `<optgroup>`ed by workspace instead, and the created item
takes `workspace_id` from the **chosen collection**, never from the active workspace — those
differ the moment you plot into another workspace from here.

## The calendar is the ONE view that spans workspaces

Every other surface is scoped to the active workspace. The calendar deliberately is not (asked for
2026-08-17): a deadline is a deadline whether it came from work or personal, and splitting them
means checking two calendars to answer "what's today". `useDatedItems` in `lib/calendar-items.ts`
queries `workspace_id IN (…)` over the visible set.

- **No sync-rule or schema change was needed.** `sync-rules.yaml` already buckets one
  `workspace_content` per membership, so every workspace's items are on the device already; this
  only stopped filtering them out. Reading across workspaces is authorised by construction.
- **The authorised set is `useVisibleWorkspaces()`** (`lib/use-workspaces.ts`), NOT the raw
  `workspaces` table — the replica can hold workspaces the server no longer acknowledges, so the
  `knownWorkspaceIds` filter has to apply here as much as in the switcher. That rule now lives in
  one hook, which the sidebar uses too, precisely so the two can't drift.
- **Opening an item switches the active workspace** when it belongs to another one. The card
  renders inside its collection, which is workspace-scoped, so following the item is the only
  coherent option — leaving the sidebar pointed elsewhere shows you a card from a workspace you
  are apparently not in.
- **Badges only appear with two or more workspaces.** Same rule as the collection picker: a label
  that says the same thing on every row tells you nothing. `SELECT … WHERE 1 = 0` covers the
  still-loading case, because `IN ()` is not valid SQLite.
- There is deliberately **no per-workspace show/hide** (Google's calendar checkboxes). If mixing
  ever becomes the complaint, that is the feature to add — not a second scoped calendar.

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
