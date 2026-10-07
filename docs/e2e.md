# E2E testing — the "done gate"

A feature is **done only when its Playwright spec passes** against the real, running stack. Because
TendTo is local-first, the only honest test drives the whole loop: browser → local SQLite replica
(OPFS/wasm) → PowerSync → FastAPI → Postgres → back to a second device.

## Run it

```bash
make e2e        # boots the backend stack, runs the main suite, then the PWA suite
make e2e-pwa    # PWA suite only — no backend needed
```

`make e2e` runs `scripts/e2e-stack.sh` (idempotent) then `apps/web` → `npm run e2e`, and finishes
with `make e2e-pwa`. The suite is Chromium-only — PowerSync's wasm SQLite persists to OPFS, which
needs a Chromium secure context (`localhost` qualifies). Report/artifacts (trace, video,
screenshots on failure) land in `apps/web/playwright-report/` and `apps/web/e2e/.artifacts/`.

### Why the PWA suite is a separate config
`playwright.pwa.config.ts` (specs in `apps/web/e2e-pwa/`) exists because the main suite
**structurally cannot** cover the installable PWA: it runs `npm run dev`, and the service worker
and web manifest only exist after `vite build`. So the PWA config builds and serves with `vite
preview` on `:15174` instead, and never reuses an existing server — a stale `dist/` would silently
test the previous manifest. It needs no backend: a fresh browser context has no session, so the
app settles on the sign-in screen, which is exactly the shell an offline cold boot must render.

### First-time prerequisites
- **Bun** (for the auth service): `curl -fsSL https://bun.sh/install | bash`, then
  `cd apps/auth && bun install`.
- **Docker images**: `journeyapps/powersync-service`, `postgres:16`, `mongo:7` (pulled on first
  `docker compose up`).
- **Web + Playwright**: `cd apps/web && npm install && npx playwright install chromium`.
- **API venv**: `python3 -m venv apps/api/.venv && apps/api/.venv/bin/pip install -e "apps/api[dev]"`.

### Services the stack boots (dev ports)
Postgres `:15432` · Mongo (PowerSync bucket storage) · PowerSync `:18080` · better-auth `:13001` ·
FastAPI `:18000` · Vite `:15173` (started by Playwright). See `scripts/e2e-stack.sh`.

## Feature → spec matrix (the checklist)
| Phase | Spec | Verifies |
| --- | --- | --- |
| 1 | `auth.spec.ts` | sign up → app w/ workspace · sign out → auth screen · sign back in |
| 1 | `sync-loop.spec.ts` | edit persists across reload **and** syncs to a second device (fresh replica) |
| 1 | `offline.spec.ts` | edit made offline uploads on reconnect and reaches a second device |
| 1 | `editor.spec.ts` | multi-block content persists across reload |
| 2 | `collections.spec.ts` | checklist add + complete (persists) · kanban drag To do → Done (persists) |
| 3 | `calendar.spec.ts` | due-dated item appears on the calendar and links to its collection |
| 3 | `search.spec.ts` | ⌘/Ctrl-K finds a block by content and navigates to its page |
| 3 | `export.spec.ts` | Export downloads JSON + Markdown; JSON contains the created content |
| 3 | `ai-summary.spec.ts` | authed `POST /ai/daily-summary` returns a non-empty summary (offline fallback) |
| 4 | `page-links.spec.ts` | `[[` links a page mid-sentence · the chip follows its target and tracks a rename · a link to a deleted page goes inert · a lone `[` is left alone |
| 4 | `backlinks.spec.ts` | a page lists who links to it and forgets a link that is deleted · a page that writes the title without linking it shows as a mention |
| 4 | `related.spec.ts` | a page suggests another that shares distinctive vocabulary, and leaves an unrelated one out |
| 4 | `ask-notes.spec.ts` | a question is answered from the matching page and cites it · the answer reaches the page only on request · an unanswerable question spends no request · no engine, no offer |
| 4 | `desktop-auth.spec.ts` | the browser app never receives the session token · the desktop shell does, and it authenticates the API |
| 4 | `e2e-pwa/pwa.spec.ts` | service worker precaches the shell **and the SQLite wasm** · manifest is installable (192 + 512 + maskable icons, all served) · reload with the network off still renders |

## How the harness works
- `e2e/global.setup.ts` — a health gate: fails fast with a clear message if the stack is down.
- `e2e/fixtures.ts` — the `authedPage` fixture signs up a **fresh** user per test via the
  better-auth API (cookie in the browser context), opens the app, and waits for
  session → `/bootstrap` → PowerSync sync → sidebar. Per-test users isolate state on the shared
  Postgres.
- `e2e/helpers/` — `api.ts` (session-cookie → JWT → authed API calls, second-device sign-in),
  `data.ts` (unique users). Cross-device tests open a **second browser context** (a fresh OPFS
  replica) as the same user.
- Sync is asynchronous → specs use web-first retrying assertions with generous timeouts, never
  fixed sleeps for correctness (only small waits to let debounced saves flush before a reload).

## Bugs this suite caught on first live run
Running the stack for real (not just unit tests) immediately surfaced five issues:
1. **Editor lost all content** — `persistBlocks` used `INSERT … ON CONFLICT` on a PowerSync table,
   which is a SQLite **view** → `cannot UPSERT a view`; every save silently threw. Fixed to
   UPDATE-then-INSERT (`apps/web/src/lib/blocks/serialize.ts`).
2. **Item edit race** — `patchItem` merged onto a stale row snapshot, so quick successive edits
   (title then due date) clobbered each other. Fixed to re-read current properties first
   (`apps/web/src/lib/items/mutations.ts`).
3. **Sync rules invalid** — a `user_meta` bucket JOINed two tables; PowerSync data queries must be
   single-table. Folded workspaces/memberships into `workspace_content`
   (`infra/powersync/sync-rules.yaml`).
4. **PowerSync couldn't replicate** — pgwire requires `sslmode: disable` against the plain dev
   Postgres (`infra/powersync/config.yaml`).
5. **Bucket storage** — the Postgres-storage path hit a pgwire bug on Postgres 16; switched dev to
   MongoDB (PowerSync's canonical self-host storage) in `docker-compose.yml`.
