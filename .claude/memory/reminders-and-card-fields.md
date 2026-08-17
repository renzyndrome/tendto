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

## The card detail dialog (2026-08-05) — what it deliberately is NOT

Clicking a card opens a detail dialog, Trello-style. Renzy asked for "the behavior of Trello";
the answer was yes to the dialog, no to Trello's card. What it carries: title, a rich
description, status, due (+optional time), assignee, delete. What it does not, and why:

- **Activity feed** — `03-roadmap.md:122` rules it out by name.
- **Comments** — planned for Phase 2 and needs its own infra pass (`03:63`); don't pre-build.
- **Attachments** — needs the S3/object storage in `02:166`, which doesn't exist yet.
- **Labels / custom fields** — `03:118`, "endlessly configurable databases… pick the 80%".
- **Per-card checklists** — the architectural one: collections ARE "one primitive, many views",
  so a checklist nailed inside a card creates a second checklist concept that no view can render
  and the calendar can't see. Sub-tasks belong in the collection.

`e2e/item-detail.spec.ts` asserts those four are absent, so re-adding one is a deliberate act.

**The dialog is a ROUTE** (`/c/$collectionId/i/$itemId`), not component state — linkable, Back
closes it, a reload reopens the same card. Consequence for tests: it is a full-screen overlay,
so a spec that leaves it open will find the board and sidebar unclickable, and a reload on that
URL reopens it (don't click the card again).

**Item descriptions reuse `blocks`** rather than getting a table: `blocks.page_id` became
nullable, `item_id` was added, and a CHECK enforces exactly one owner (migration 0004). So a
card body is the same primitive as a page body — same editor, same paste handling, same inline
images — via a shared `BlockEditor` and a `BlockOwner` union in `serialize.ts`. Search filters
to `page_id IS NOT NULL` because a block hit navigates to a page.

**Adding an item only opens the dialog where the title can't be typed inline** (board, list).
Checklist and table keep fast inline capture.

**The description is the SAME editor presented compactly — not a different one.** Renzy rejected
the full block surface in the card ("should be a text area box with toolbox formatting and
markdown support like in Linear"). The answer was `BlockEditor variant="compact"`, which turns
off `sideMenu` (the drag-handle/add-block gutter — that gutter *is* the "blocks" feel) and
`tableHandles`, and styles the container as a bordered field. Markdown input rules, the
selection formatting toolbar and "/" all stay, so it behaves like Linear. Storage is unchanged,
which is the point: no migration, and paste/inline images keep working.

The compact toolbar is **persistent, not floating**, and **curated**: block-type select, bold,
italic, strike, code, link. BlockNote's default set adds four alignment buttons, a colour picker
and nesting controls — in a card description that is the "endlessly configurable" clutter doc 03
rules out. Rendered by passing `formattingToolbar={false}` and a `<FormattingToolbar>` child.

**Type scale in the card dialog is 18 / 14 / 12** — title / body+controls / labels. BlockNote's
editor defaults to 1rem, which is a *page's* reading size; next to 12px labels and selects it
made the description the loudest element in the dialog. `.tendto-compact-editor .bn-editor` is
pinned to 0.875rem and the controls were raised to match, so body and chrome agree. Headings
scale off that base automatically because `--level` is in `em`.

**Controls stretch to the description box's right edge.** They used to cap at `max-w-[16rem]`
while the description ran full width, leaving a ~260px ragged right edge. Every row — header,
fields, description, footer — now shares one `px-5` gutter on both sides.

Five CSS gotchas when restyling that editor:

- **Firefox draws its own focus outline on `contenteditable`; Chromium does not.** It rendered
  as a hard second box nested inside the description field — visible to Renzy, invisible in
  every Chromium probe and in the whole e2e suite (which is Chromium-only, see
  playwright.config.ts). `.bn-editor`/`.tiptap` now set `outline: none` and the focus treatment
  lives on the container as a low-alpha ring. **When a UI report doesn't reproduce, check the
  browser before doubting the report** — `npx playwright install firefox` and drive it.

- **BlockNoteView renders children AFTER the editable content**, so a static toolbar lands
  *below* the text. Make `.bn-container` a flex column and give the toolbar `order: -1` — do NOT
  absolutely position it, which overlaps the text as it grows.
- **Heading size comes from a `--level` custom property**, not `font-size`
  (`[data-content-type=heading][data-level="2"]{--level:2em}` plus a more specific
  `font-size: var(--level)` rule). Overriding `font-size` silently loses; override `--level`
  and `--prev-level`.
- **The 54px side padding on `.bn-editor` exists to clear the side menu.** With the menu off it
  is dead space — collapse it rather than negative-margining the wrapper.

## PowerSync `execute()` ALWAYS reports `rowsAffected: 0` — never branch on it

The block upsert was "UPDATE, and INSERT if `rowsAffected` is 0". PowerSync tables are SQLite
VIEWS, so `INSERT … ON CONFLICT` is rejected (hence the two-step) — but `execute()` also reports
`rowsAffected: 0` for an UPDATE that genuinely changed a row. The INSERT therefore ran every
time: the first save of a block worked, and every save after it raised a UNIQUE violation that
rolled the transaction back and **silently reverted the UPDATE that had just succeeded**.

Effect: only the FIRST edit of any block ever persisted — card descriptions AND page bodies —
while the UI cheerfully showed "Saved". It survived a long time because every e2e test typed
once and reloaded; you only see it on the SECOND edit to the same block. `writeBlocks` now
SELECTs which ids already exist (globally — ids are unique table-wide, so a block that moved
owner must be updated, not inserted) and branches on that. `e2e/item-detail.spec.ts` and
`e2e/editor.spec.ts` now both edit twice.

A `UNIQUE constraint failed: ps_data__blocks.id` in the console is the signature — I first
misread it as an overlapping-save problem, which was a real but separate issue.

## Autosave: async writes cannot survive page teardown — stash synchronously

Everything is autosaved (debounced 500ms for bodies, 400ms for titles, plus a flush on blur and
on unmount), and the card dialog now SAYS so ("Saving…" / "Saved") because silent autosave reads
as "did that save?".

The non-obvious part: flushing on `pagehide` does **not** rescue a reload mid-edit. Writes go to
the replica through PowerSync's worker, and the browser will not wait for a promise — measured:
typing then reloading immediately lost the body AND the title, while closing the dialog or
pressing Escape were fine (those unmount, and the cleanup runs). `localStorage` is synchronous,
so `lib/drafts.ts` stashes the pending value on `pagehide`/`visibilitychange` and replays it into
the replica on the next mount, clearing the draft once a real save lands. A draft can therefore
never shadow synced content. This applies to page titles and page bodies too, not just cards.

Two traps found while building that:
- **A write that has been ISSUED is not a write that has LANDED.** Clearing the "dirty" flag when
  a save starts means the page-hidden stash sees nothing pending and skips the draft — so an
  in-flight write lost on teardown takes the text with it. Track in-flight separately.
- **Recovery must clear the draft even when no write is needed.** If the previous session's
  write did land, the replay early-returns because the value already matches, and the draft
  lingers forever. Clear it explicitly on that path.
- Drafts are transient, so a test asserting "no drafts exist" must poll for eventual cleanup —
  every reload legitimately writes one on the way out.

**Never depend on a freshly-built object in a React hook's deps.** `BlockEditor` took an `owner`
prop that callers build inline (`itemOwner(row.id)`), so it was a new object every render: the
save callback changed identity every render, its unmount-flush effect re-ran every render, and
two saves of the same document could overlap. Since the upsert is UPDATE-then-INSERT (PowerSync
tables are views, so `ON CONFLICT` is rejected), both found no row to update and both inserted —
`UNIQUE constraint failed: ps_data__blocks.id` in the console. Fixed twice over: depend on the
primitives (`kind`, `id`) inside the component, and serialise `persistBlocks` per owner so a
debounced save and an unmount flush can't interleave.

**Escape must check for BlockNote popups first.** The slash/emoji menu and link toolbar render
in a portal OUTSIDE the dialog, so a plain `keydown` listener closed the whole card when the
user only meant to dismiss the menu — losing their place mid-edit. `item-detail.tsx` ignores
Escape while `.bn-suggestion-menu, .bn-link-toolbar` is present.

## Item properties are a read-modify-write — always in a transaction

`patchItem` reads the whole `properties` bag and writes it back. Callers fire these without
awaiting (a title committing on blur, then a due date a moment later), so outside a transaction
the second read can land before the first write commits and silently drop the first field —
setting a title then a due date really did lose the title. The read now happens INSIDE
`db.writeTransaction`, which serialises it. Same for `moveItemToStatus`. Covered by
"editing two fields back to back keeps both".

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
