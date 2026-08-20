# 03 — Roadmap (Strategic)

High-level phases, not a sprint plan. The point is **sequence and de-risking**, not estimates.
Each phase has an explicit "done means" so you know when to move on.

## Phase 0 — Prove the sync loop (spike, throwaway)

The architecture's one concentrated risk is the engine loop: **BlockNote → local SQLite →
PowerSync → FastAPI → Postgres → back down to another device.** Prove it before real code.

- A single page with the BlockNote editor, persisting blocks to the local replica (debounced).
- PowerSync (cloud instance is fine for the spike) + a minimal FastAPI `uploadData` endpoint +
  Postgres with sync rules for one workspace.
- Test A (instant + live): edit on your laptop → change appears on your phone's browser in ~a
  second; page loads/switches feel instant on both.
- Test B (offline): airplane-mode one device, edit the same page on both, reconnect → queued write
  uploads, LWW resolves, both devices converge; nothing lost silently on the *different-blocks*
  case.

**Done means:** you've personally watched instant local editing, live cross-device sync, *and* an
offline edit merge on reconnect. That's all three product promises in one loop. *Throw the spike
away afterward.*

> **Status (2026-07-09):** the loop is implemented directly on the scaffold (not a throwaway spike,
> since the scaffold already de-risks it): FastAPI `POST /sync/upload` (membership/role + LWW
> upsert, 17 tests green), Alembic migration, BlockNote⇄replica editor. Left to run live: stand up
> `apps/auth` (Bun) + the PowerSync container and watch the two-device / airplane-mode tests.
>
> **Status (2026-08-17): closed.** The whole stack runs locally with one command (`make dev`), and
> both tests are automated rather than watched by hand — `e2e/sync-loop.spec.ts` drives a second
> browser context for the cross-device update, and `e2e/offline.spec.ts` covers the airplane-mode
> queue-and-merge.

## Phase 1 — MVP: your tasks, on every device, instantly

The smallest thing genuinely pleasant to use daily. Single-user, but the full sync model — so
**instant feel, multi-device sync, and offline all ship in the first phase**; they're structural.

- Accounts (better-auth: email/password + OAuth) and a personal workspace; PowerSync auth via
  better-auth's JWT plugin (JWKS).
- Pages tree / sidebar (notes by category).
- WYSIWYG block editor with a curated block set (text, headings, lists, checkboxes, quote, divider,
  code, image) — resist adding more.
- A simple to-do experience (checkbox blocks or a lightweight task list).
- **Responsive layout + installable PWA** — same app on desktop browser and phone.
- New-device flow: sign in → progressive initial sync (current workspace first).

**Done means:** you've stopped using your old notes app, you routinely check off a task from your
phone that you created on your laptop, and doing so in a dead zone doesn't matter.

> **Status (2026-07-09):** MVP foundation built — better-auth email/password sign-in, `POST
> /bootstrap` provisioning the personal workspace, app shell + reactive page sidebar, and the
> block editor persisting to the replica. Remaining Phase-1 polish: pages *tree* (nesting), the
> curated block set/toolbar tuning, PWA install check, and a live end-to-end run.
>
> **Status (2026-08-17): closed.** Nested pages (`parent_id`, collapsible tree), the curated block
> set with markdown shortcuts and inline images, and the installable PWA are all in. `/bootstrap`
> is now concurrency-safe — the client calls it from an effect that React StrictMode
> double-invokes, and check-then-insert without serialisation gave every dev user two identical
> "My Workspace" rows.

## Phase 2 — Collections, kanban & the startup workflow

Turn it from a notebook into a light workspace — and make it multi-user.

- **Collections** with **checklist, list, table, and board (kanban)** views over the same items
  (JSONB properties; one primitive, many views). All instant — they're local queries.
- The startup task workflow: a default board/template, statuses, assignee, due date.
- **Shared workspaces**: invitations, memberships, roles (owner / editor / viewer) — enforced in
  FastAPI on upload *and* in sync rules on download (doc 02, doc 05).
- **Live collaboration, calm edition:** teammates' changes arrive via the sync stream automatically;
  add lightweight **presence** ("who's here") over a small ephemeral channel. Character-level
  co-editing stays deferred.
- **Comments & @mentions** on pages/blocks — ordinary rows, they sync like everything else.
- Strong default templates for the core use cases (this *is* the product — doc 01 §4).

**Done means:** your startup is running its tasks in it instead of a separate tool.

> **Status (2026-07-09):** collections shipped — one `items` primitive rendered as four views
> (checklist, list, table, kanban board with drag-between-columns), inline editing everywhere,
> all instant from the replica and synced through the *existing* generic write path (zero backend
> change — collections/items already had models, sync rules, and schema). Still open in Phase 2:
> shared-workspace **invitations/roles** (better-auth org + email), **presence**, and
> **comments/@mentions** — each needs new infra, so each is its own pass.
>
> **Status (2026-08-17): shared workspaces are done.** Multiple workspaces (create / switch /
> rename / delete), a members panel with roles, and a full **invite → email → accept** flow.
> Enforcement is where doc 02/05 says: FastAPI on upload, sync rules on download.
>
> Two things worth recording because they amend the plan as written:
>
> 1. **Workspace invitations are owned by FastAPI, not better-auth's organization plugin**
>    (which doc 05 §3 names for "orgs/invites"). That plugin invites to an `organizationId`, but
>    tenancy here is `memberships(user, workspace, role)` and `workspaces` still has no `org_id`
>    — so using it would mean one better-auth org per workspace *and* workspace/role semantics
>    living inside `apps/auth`, which is infrastructure only. When Organizations actually land,
>    the org plugin can own ORG membership while workspace membership stays in the API.
> 2. **Email is provider-agnostic with an offline fallback**, mirroring the AI layer (doc 06): an
>    empty `EMAIL_API_KEY` logs the mail and returns the invite URL so the UI can offer a copy
>    link. Dev and the whole test suite stay network-free; a Resend key makes it send for real.
>
> Also shipped in this pass, all Phase-2-adjacent: **card detail** (a dialog per item at
> `/c/$collectionId/i/$itemId` with a rich description — see the guardrail note below), the
> **startup task workflow** fields (assignee picked from workspace members, due date + optional
> time), and **light/dark theming**. Still open in Phase 2: **presence** and
> **comments/@mentions**.
>
> **Status (2026-08-20): comments & @mentions are done.** A flat thread under every page and
> every card, with `@` picking from the workspace's members. Three decisions are worth carrying
> forward:
>
> 1. **A mention highlights and does nothing else** — no notification, no badge, no inbox. The
>    collaboration-noise guardrail rules out being told what other people did; seeing your own
>    name stand out when you open the thread is the entire feature. (Contrast the due-reminder
>    clarification below: that one is *your own* deadline, which is why it was allowed.)
> 2. **Tenancy grew a third shape: author-owned rows inside a workspace bucket.** Comments reach
>    every member (that is what a comment is for), but membership no longer implies the right to
>    write any row in the table: only the author may edit their own comment, and only a workspace
>    owner may delete someone else's — never edit it, since that would put words in their mouth.
>    Enforced in `sync.py` (`AUTHOR_OWNED_TABLES`), not in the client. Commenting itself still
>    rides the existing write roles, so a **viewer reads but cannot post**; a dedicated
>    `commenter` role stays a later, deliberate decision (doc 05 §3).
> 3. **Mentions are inline text tokens** (`@[<user_id>:<label>]`), not a side table of offsets.
>    Offsets go stale the moment the comment is edited, and the embedded label is what lets a
>    comment render on a device that has never fetched the member roster — user records live in
>    better-auth and never sync. The same reasoning gave the row a denormalized `author_label`,
>    which the server stamps from better-auth rather than trusting the client: it is the only
>    identity a reader ever sees.
>
> Still open in Phase 2: **presence**.

## Phase 3 — Calendar, the AI summary & polish

Add the "organize your life" layer and the signature default feature, then harden.

- **Calendar view**, plus the **unified calendar** overlaying date-bearing items across collections
  (tasks + game sessions + movies) — an instant local query.
- **Signature default: the end-of-day AI summary** (wins + task status) as a FastAPI scheduled job
  with a model-choice setting and one off-toggle (doc 02 §A, doc 06).
- **Search**: local SQLite FTS for instant workspace search; pgvector semantic search later.
- Sync hardening: conflict edge cases, long-offline reconnects, "updated elsewhere" notices,
  initial-sync performance.
- Reliability: backups verified, restore drill, full **export** (JSON + Markdown); the
  `docker compose` **self-host** path (FastAPI + Postgres + PowerSync open edition).

**Done means:** your tasks, game sessions, and lists show up on one calendar, and you get a useful
daily recap each evening.

> **Status (2026-07-09):** the Phase 3 headliners are built and verified — **unified calendar**
> (month grid over every date-bearing item, instant local query), **instant search** (Cmd/⌘K
> palette over pages/blocks/items; LIKE for MVP, FTS5 noted as the later step), full **export**
> (JSON + Markdown download from the replica), and the **daily AI summary** (FastAPI
> `POST /ai/daily-summary`, provider-agnostic with an offline no-key fallback; the scheduled
> ambient job is scaffolded, delivery + scheduler deferred). Still open in Phase 3: **pgvector
> semantic** search/Q&A, the **backup/restore drill**, and sync-hardening edge cases — all need
> live services (and an LLM key) to build meaningfully.
>
> **Status (2026-08-17):** the calendar gained a **day view** (`/calendar/$date`) — a Google-style
> time grid you reach by clicking a day, where a task can be plotted on a slot and dragged to
> another time. One thing there is worth carrying forward: an item is a **deadline, not a
> meeting**. It has a due moment and no duration, so a block is one slot tall as an anchor, and
> the all-day row is simply the existing "date with no time". Giving items a duration would turn
> this from a task list into a scheduler — a Phase-4-at-earliest decision that has to be argued
> on its own, not slipped in as calendar polish.
>
> **"Unified" now also means across workspaces.** The calendar shows date-bearing items from every
> workspace you belong to, each badged with its own, and opening one switches you into it. It is
> the *only* view that spans workspaces, deliberately: "what's today" is a question about your day,
> not about which sidebar you last clicked. No sync-rule or schema change was needed — sync rules
> already bucket one per membership, so the data was on the device already. The tenancy boundary
> is untouched: you still only ever read workspaces you're a member of.

## Phase 4 — Native shells & earned nice-to-haves

- **Native shells if earned** (doc 04): a Tauri desktop wrapper — now with a real rationale beyond
  feel: **native SQLite is durable** where browser OPFS storage can be evicted — and/or a mobile
  shell (Capacitor wrap, or React Native + Expo; PowerSync ships SDKs for both paths).
- Then, and only then, weigh remaining nice-to-haves **one at a time** against the clutter test:
  character-level co-editing (Yjs per active page), broader AI (inline writing, Q&A over notes),
  web clipper, public publishing, API, timeline/Gantt, end-to-end encryption.

**Done means:** anything added since Phase 3 has earned its place.

---

## What we are deliberately NOT building (guardrails)

- ❌ A plugin marketplace / scripting platform — how Obsidian and Notion accreted clutter.
- ❌ **A hand-built sync engine.** We went local-first *because* instant-feel is a pillar — but we
  buy the machinery (PowerSync), we don't own a CRDT substrate or a sync protocol. If the engine
  ever fails us, the exit ramp is plain rows in our own Postgres.
- ❌ AI sprayed across the editing surface — the *only* default AI is the once-a-day summary.
- ❌ Endlessly configurable databases (relations-of-relations, formula sprawl) — pick the 80% and stop.
- ❌ Collaboration *noise* — activity feeds, notification systems, granular field-level governance.

  > **Clarified 2026-08-17, because we shipped something adjacent.** Desktop reminders now exist
  > for items due *today* and for Pomodoro phase changes. The line we drew: this bullet rules out
  > being told **what other people did** — feeds, badges, digests. It does not rule out being told
  > **your own deadline just arrived**, which is the point of putting a due date on a task at all.
  > Kept honest by construction: opt-in (browser grant *and* an in-app switch), device-local (no
  > server job, no push channel), today-only so a backlog can't notify in bulk, silent for
  > anything already done, and one notification per item. If it ever grows a digest or a badge
  > count, it has crossed the line.
- ❌ **Gamification that scores you.** Focus mode grew stats and a garden on 2026-08-18, and the
  research we did first is why it stops where it does. Forest's power comes from *loss* — your
  tree dies if you leave — and that is exactly the mechanic tied to guilt and streak anxiety; we
  took the cultivation metaphor and left the punishment, so nothing here ever dies or is taken
  away. Ruled out by name: **XP, levels, coins, unlockable badges, and a streak counter that
  resets to zero** (a debt, not a habit — "days focused this week" says the same thing without
  the cliff). The test any future addition must pass: *if you could maximise the number without
  actually focusing more, it doesn't ship* — which is why growth tracks minutes, never session
  count. Leaderboards and teammate comparison stay out under the collaboration-noise bullet.
- ❌ Feature parity with Notion as a goal. Parity is the trap (doc 01 §3). **Focus is the moat.**
- ❌ **The Trello card.** Cards open a detail dialog (added 2026-08-17) carrying a title, a rich
  description, status, due and assignee — and deliberately *not* labels, per-card checklists,
  attachments or a comment/activity panel. The first is the "configurable database" sprawl above;
  attachments need object storage that doesn't exist yet; the feed is the noise bullet. Per-card
  checklists are refused on structural grounds, not taste: collections are "one primitive, many
  views", so a checklist nailed inside a card would be a second checklist concept that no view
  can render and the calendar can't see. Sub-tasks belong in the collection.

## The recurring decision rule

For every proposed feature, in every phase, ask the README's question:
**"Does this add clutter?"** If yes → hide it behind progressive disclosure, defer it, or kill it.
Speed and calm are the features you're actually shipping — and speed is now structural.
