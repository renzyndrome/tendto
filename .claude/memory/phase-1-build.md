---
name: phase-1-build
description: What shipped in the Phase 0→1 MVP build and the non-obvious decisions behind it
metadata:
  type: project
---

Built 2026-07-09 (the first real implementation on top of the scaffold). The Phase 0 sync loop
and the Phase 1 single-user MVP foundation are implemented across all three apps; Phases 2–4
(collections/kanban, live collaboration + presence, calendar, AI summary) are deliberately not
started yet. See [[auth-and-sync-redesign]] for the auth/sync stack this builds on.

**Non-obvious decisions (not derivable from the code alone):**
- **Block ids are BlockNote-owned strings, not UUIDs.** `blocks.id` is `String(64)` server-side and
  `CrudEntry.id` is `str` (the other tables keep client-generated UUIDs). BlockNote owns block
  identity; forcing UUIDs there adds friction for no gain. Still client-generated, stable, and
  replayable, so invariant #3's intent holds. This is the one documented exception to
  "all ids are UUIDs".
- **`POST /bootstrap` provisions the personal workspace**, because sync-rules gate downloads on
  membership → a brand-new user has no membership → can't create their first workspace through the
  sync upload path (chicken/egg). Bootstrap is idempotent and the only way workspaces/memberships
  are born; `/sync/upload` 403s any attempt to create a workspace. The web client calls it once
  after sign-in, before any writes.
- **Cross-tenant move is blocked in the write path**: `_assert_can_write` resolves an existing
  row's workspace from its *stored* value (never the client-supplied one), and `_apply_entry` pins
  the tenant column — a write can't relocate a row to another workspace even if the client belongs
  to both. (RLS is still the planned layer-3 backstop.)
- **Editor persistence = hydrate-once-per-page + debounced (500ms) upsert**, NOT a reactive query
  bound to the open editor (that fights BlockNote's own document state). Live edits to the *same
  open page* from another device are Phase 2.
- **`apps/web` versions are pinned, not "latest"**: BlockNote 0.51.4 (+ the `@blocknote/mantine`
  adapter — 0.51's react pkg is headless-only), Tailwind v3 (v4 changed the PostCSS plugin), Vite 7
  (v8/rolldown breaks `vite-plugin-top-level-await`). "latest" combos break the build.

**Phase 2 (collections) — 2026-07-09:** the `items` primitive now renders as four projections —
checklist, list, table, and a kanban **board** (native HTML5 drag between status columns) — under
`apps/web/src/components/collection/`, with item writes in `lib/items/mutations.ts` (properties is
a merged whole-bag write; `status ∈ todo|doing|done`, `status==="done"` = checklist checked).
**No backend change** — collections/items already synced through the generic upload path. Still
open in Phase 2: invitations/roles (better-auth org + email), presence, comments/@mentions.
Known gap: `apps/web` has a `lint` script but no `eslint.config.js` (scaffold never wired it);
strict `tsc` is the enforced gate.

**Phase 3 (calendar / search / export / daily AI summary) — 2026-07-09:**
- Frontend (`apps/web`), all instant/local over the replica: unified **calendar** (`/calendar`,
  month grid over items with a `properties.due`, queried via `json_extract`), **instant search**
  (Cmd/⌘K palette, LIKE over pages/blocks/items — FTS5 is the later optimization), and workspace
  **export** (`lib/export.ts` → JSON + Markdown download). Shared `lib/blocks/text.ts` extracts
  block text for search + export.
- Backend (`apps/api/app/ai/`): the **ambient daily summary** — `provider.py` (OpenAI-compatible
  `HttpChatProvider` + `FallbackProvider` that needs no network/key), `summary.py`
  (`build_daily_summary`, tenancy-scoped activity via `memberships` join, UTC day bounds),
  `POST /ai/daily-summary` (user-triggered), and `jobs.py::run_daily_summaries()` scaffold
  (scheduler + delivery deferred). Config: `AI_BASE_URL`/`AI_API_KEY`/`AI_MODEL` (empty key ⇒
  offline fallback, so tests need no network). 23 API tests pass.
- **Still deferred** (need live infra/keys, not built): Phase 2 invitations/roles + presence +
  comments; Phase 3 pgvector semantic search/Q&A, interactive AI (Summarize/Ask AI), backup-restore
  drill, real scheduler + summary delivery.

**Solo-use completeness — 2026-07-12:** filled the daily-driver gaps for single-user use —
**editable page titles** (`page-editor.tsx`), **nested pages** ("categories": `parent_id` tree +
add-subpage + collapse in the sidebar), and **delete** for pages (cascades subpages+blocks) and
collections (cascades items) via `lib/pages.ts` + `lib/collections.ts`. BlockNote's slash-menu /
input-rule block set (headings, lists, checkboxes, quote, code, table) works out of the box; image
*upload* is deferred (needs object storage — image-by-URL works). Row actions are hover-revealed
(clutter-free).

**E2E done-gate (Playwright) — 2026-07-12:** `make e2e` boots the full stack and runs 15 specs
(one+ per feature, incl. titles/nesting/delete/block-types) through a real browser — all green. See `docs/e2e.md` +
`apps/web/e2e/`. Chromium-only (OPFS). Per-test fresh user via the better-auth API
(`e2e/fixtures.ts`); cross-device tests use a second browser context (fresh replica). Running it
LIVE surfaced 5 real issues unit tests missed, now fixed:
1. **Editor never persisted** — `persistBlocks` did `INSERT … ON CONFLICT` on a PowerSync **view**
   ("cannot UPSERT a view"); switched to UPDATE-then-INSERT. (PowerSync tables are views — never
   UPSERT/`INSERT OR REPLACE`; plain INSERT/UPDATE/DELETE only.)
2. **Item patch race** — `patchItem`/`moveItemToStatus` merged onto a stale snapshot; now re-read
   current properties from the replica first.
3. **Sync rules** — the `user_meta` bucket JOINed tables (illegal; data queries are single-table);
   folded workspaces+memberships into `workspace_content`.
4. **pgwire needs `sslmode: disable`** for the plain dev Postgres (managed PG has SSL).
5. **Bucket storage** — Postgres-storage hit a pgwire bug on PG16; dev now uses **MongoDB** (added
   to `docker-compose.yml`), PowerSync's canonical self-host storage. Postgres stays the source.

**Verify/run:** `make db` then API venv `pytest` — **23 pass**. Web: `npm run typecheck` +
`npm run build` green. Full stack + E2E: `make e2e` (needs Bun + Docker images; first run pulls
mongo:7 & powersync). All 5 dev services now boot cleanly.
