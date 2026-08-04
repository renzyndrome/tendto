---
name: reminders-and-card-fields
description: Due date+time format, the assignee picker, and why due reminders are device-local and opt-in
metadata:
  type: project
---

Added 2026-08-04.

## Due dates carry an optional time

`item.properties.due` is `YYYY-MM-DD` **or** `YYYY-MM-DDTHH:MM`. Keeping the date as the prefix
was deliberate: everything that only cares about the day (the calendar grid's `slice(0, 10)`,
the daily summary) keeps working, and existing date-only rows stay valid with no migration.
Times are LOCAL wall-clock, never UTC — "due at 5pm" means 5pm where you are, and a synced
replica must not shift it when you travel. All-day items resolve to 23:59 (`dueAt`), so an item
due "today" isn't overdue at 00:01. Helpers live in `lib/items/due.ts`; never parse `due` inline.

## Assignee is a member picker, not free text

The stored value is still a plain string (the member's **email**), which is why existing
free-text assignees keep working and why the value stays readable offline and in exports.
An unrecognised value is still offered as an option so re-picking is a choice, not silent data
loss. The member list can't come from the replica — membership rows sync as opaque better-auth
user ids, and the readable email lives in better-auth's `user` table, which never syncs — so
it's an API call cached per workspace in `lib/items/assignees.ts`. Membership changes call
`invalidateAssignees()`.

## Due reminders are device-local, time-triggered, and opt-in

- **Not a server job and not push.** The watcher reads the replica, so it works offline; a
  reminder belongs to the device you're sitting at, not to every device you own.
- **Polling, not reactive queries.** A reminder fires because *time* passed, not because data
  changed, so a replica subscription would never trigger it. It also re-checks on
  `focus`/`visibilitychange` — background timers are throttled hard, and a laptop that slept
  through a deadline should tell you when you come back.
- **Concurrent passes are coalesced.** The interval, focus and visibility listeners can all fire
  within milliseconds; a pass reads the "already notified" set at the start and writes it at the
  end, so two overlapping passes would each decide an item was un-notified and fire twice. An
  e2e test asserts exactly one notification survives repeated nudges and a reload.
- **Today only, never done.** An overdue backlog would notify in bulk at every launch. "Done"
  means the board's LAST column, matching the checklist's semantics.
- **Opt-in means BOTH** browser permission granted AND TendTo's own switch on — the stored value
  must be exactly `"on"`. Treating "not off" as enabled meant a site permission granted for some
  other reason silently started firing reminders.
- This is not the "notification systems" ruled out in docs/planning 03 — that's activity feeds
  about what *other people* did. This is your own deadline, with no digest and no badge count.
- Pomodoro notifications use their own tag (`tendto-pomodoro`) so the OS can't have a due
  reminder replace a phase change or vice versa.

## The board card title wraps; the VALUE is still one line

A board card is ~18rem wide, so a long title in an `<input>` scrolled horizontally and showed
only the fragment around the caret — the card read as truncated nonsense. `InlineText` now takes
`multiline`, which swaps in an auto-growing `<textarea>`. That is presentation only: Enter still
commits (never inserts a newline) and pasted newlines collapse to spaces, because the title
round-trips into table cells, list rows, calendar chips and exports, all of which assume one
line. Collapsed cards also show due + assignee as wrapping chips, so the common facts are
readable without expanding.

## Testing writes before a reload

Several card tests flaked because they reloaded before a fire-and-forget `patchItem` had
landed. Asserting the field's own value proves nothing — that's local draft state. Gate on a
component rendered from the REACTIVE QUERY instead (a collapsed card's chip, another view's
text). Do NOT gate by switching collection views: `switchView` writes `default_view`, which is
its own un-awaited write and reintroduces the race. Where persistence is already covered
elsewhere, drop the reload and test the one property the spec is actually about.

## Rich paste already worked — don't "fix" it

Pasting formatted HTML (headings, bold/italic, links, bullet + numbered lists, quotes, code)
survives both the paste and the reload. `lib/blocks/serialize.ts` is generic — it stores
`props`/`content`/`children` for any block type — which is what makes that true, so keep it
type-agnostic. `e2e/paste-formatting.spec.ts` guards the round-trip through the replica, which
is the half that would fail silently (it would look right until reload, then flatten).
