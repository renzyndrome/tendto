# Comments & @mentions (2026-08-20)

A flat comment thread under every page and every card. The last big Phase-2 product feature;
only **presence** remains.

## The tenancy lesson: bucket ≠ permission

Before this, "who owns a row" and "which bucket does it ride" were the same question —
`workspace_content` (keyed on `workspace_id`) or `user_private` (keyed on `user_id`). Comments
split the two apart, and that is the durable idea:

- **The bucket answers who READS.** Comments are team-visible; that is what a comment is for. So
  plain `workspace_content`, no new bucket, no sync-rule cleverness.
- **The upload path answers who WRITES.** After the normal membership + role check, `sync.py`
  compares the row's **stored** `author_id` against the token subject
  (`AUTHOR_OWNED_TABLES = {"comments"}` → `_assert_comment_author`).

The write matrix, and why: only the **author** may edit their own comment; a workspace **owner**
may DELETE another member's (moderation) but never EDIT it — editing would put words in someone
else's mouth, which no role should permit. `author_id` is *pinned* on create the same way
`workspace_id` always was, so a patched client cannot post under another name.

Mechanically this generalized `OwnerPin | None` → `list[OwnerPin]` through `_assert_can_write` /
`_assert_owns_row` / `_apply_entry`. A comment write pins two columns; everything else pins one.

Commenting itself rides the existing `WRITE_ROLES`, so a **viewer reads but cannot post**. A
dedicated `commenter` role was deliberately deferred (doc 05 §3 anticipates it).

## Mentions are inline text tokens

`body` is plain TEXT containing `@[<user_id>:<label>]`. Two reasons, both learned the hard way
elsewhere in this codebase:

- A side table of offsets goes stale the instant the comment is edited. A token moves with the
  text for free.
- The **label must travel with the row**. Member names live in better-auth's `user` table, which
  never syncs — the replica has only opaque user ids (same constraint that made `assignee` store
  an email). Without the embedded label a comment could not render offline, or for a member who
  has not fetched the roster. Same reasoning gave the row a denormalized `author_label`.

`author_label` is **stamped server-side** from better-auth (`_label()` in sync.py, via
`auth_users.emails_for`) and pinned to the stored value on every later write. It started out
client-supplied and "cosmetic" — the review pushed back, correctly: the label is the *only*
identity a reader ever sees (ids are never rendered), so trusting the client would let a member
post under a teammate's name in the one feature where that would be believed. Falls back to the
user id, never to the client's value: an opaque id is at least true.

**A mention highlights and does nothing else.** No notification, no badge, no inbox. The
collaboration-noise guardrail rules out being told what other people did; the due-reminder
exception was allowed because that is *your own* deadline. If mentions ever grow a notification,
they have crossed the line.

## Four bugs worth not repeating

**A parent's cascade delete must never touch author-owned rows.** The first cut cascaded
comments client-side in `pages.ts` / `items/mutations.ts` / `collections.ts`, matching what those
functions already do for blocks. That is a **permanent device wedge**: an *editor* deleting a
page holding a teammate's comment queues a comment DELETE the author check answers with 403, the
batch aborts before commit, PowerSync re-raises, and the ordered queue retries the same batch
forever — every later write from that device blocked. Comments are now left to the server's FK
cascade (PowerSync then removes them from every replica). **The general rule: the moment a table
gets a per-row write rule, audit every client-side cascade that deletes rows the user does not
own.** Pinned by `test_an_editor_can_delete_a_page_carrying_someone_elses_comment`.

**Anything client-supplied that Postgres can reject is a wedge vector.** Same failure mode, three
ways in this one table: an unparsed ISO timestamp, an over-long `author_label` (`String(320)` vs
an unbounded better-auth display name — now truncated in `sanitizeLabel`), and the 403 above.

## Two more

**`created_at` is the SERVER's clock, so never show it or sort by it.** It is in
`_RESERVED_COLUMNS`, so Postgres stamps it when the row *uploads*, and the value syncs back down
over the client's. Two separate defects came out of this: "(edited)" derived from
`updated_at > created_at` compared two different clocks (it hid a real edit in e2e and would
equally have invented ones that never happened), and the thread's timestamp/sort order would
have told a comment written offline on Monday that it was written the moment the device
reconnected on Friday — in a **local-first** product, of all places. Fixed with two explicit
client-supplied columns, `authored_at` (what the thread sorts and dates by) and nullable
`edited_at`. Both then had to go in `DATETIME_COLUMNS`; `focus_sessions.started_at` exists for
exactly the same reason ([[focus-gamification]]).

**Caret restore after picking a mention must be synchronous.** Deferring it to
`requestAnimationFrame` let the next keystrokes land at the stale offset, so typing straight
through a mention produced scrambled text ("ping @name out the deadlineab"). A `useLayoutEffect`
applying a pending-caret ref fixes it. Any "set value then move the caret" flow has this bug.

## Shape of the UI

`components/comments/` — section (reactive query), item (chips, edit-in-place, delete), composer
(plain `<textarea>` + hand-rolled `@` picker; deliberately NOT BlockNote — a two-line reply does
not want a slash menu and drag handles). The picker carries `data-mention-menu`, which the card
dialog's Escape handler checks alongside `.bn-suggestion-menu` so dismissing it doesn't close the
card ([[phase-1-build]] has the same portal-layering trap).

Not built, on purpose: threads, resolve, reactions, block-anchored comments, an activity feed.
