# TendTo — Claude Code project guide

TendTo is a clutter-free, local-first Notion alternative. **Instant like Obsidian, synced like
Notion.** The strategic plan in `docs/planning/` is the source of truth for all architectural
decisions — read `07-stack-and-roadmap.md` first when in doubt. Do not re-litigate settled
decisions (sync model, stack, TanStack Router-not-Start, no Flutter) without being asked.

## Architecture invariants (never violate)

1. **Postgres is the single source of truth.** Device SQLite replicas are projections, synced by
   PowerSync. Never treat client state as authoritative.
2. **Every write goes up through FastAPI** (`POST /sync/upload`), which enforces membership + role
   before touching Postgres. No client writes directly to Postgres or around the API.
3. **All IDs are client-generated UUIDs; every synced row carries `updated_at`.** Writes must be
   idempotent (safe to replay from the upload queue). One documented exception: `blocks.id` is a
   BlockNote-owned string (server `String`, `CrudEntry.id` is `str`) — still client-generated and
   replayable. See [[phase-1-build]].
4. **Conflicts resolve last-write-wins at row (block/item) granularity.** No CRDTs. If asked for
   live co-editing, the sanctioned path is Yjs per active page — but it must be explicitly earned.
5. **Content state lives in the local SQLite replica** (PowerSync reactive queries), not in
   TanStack Query. Query is only for true API calls (auth, billing, AI).
6. **Tenancy**: every tenant-scoped table has `workspace_id` (and org where relevant); sync rules
   bucket by workspace; RLS is the backstop. New tables must follow this or they will not sync.

## Stack

- **apps/web**: Vite + React 19 + TypeScript, TanStack Router (NOT TanStack Start, NOT Next.js),
  thin TanStack Query, Zustand (UI state only), Tailwind + Radix/shadcn, BlockNote editor
  (without its Yjs collab mode), `@powersync/web` + `@powersync/react`.
- **apps/api**: FastAPI (async), SQLAlchemy 2 (async) + Alembic, Pydantic v2, Postgres
  (Supabase in cloud, plain Postgres in docker for dev), better-auth JWT verification (JWKS).
- **apps/auth**: better-auth on Hono + Bun (dev :13001) — sessions, organizations/invites, JWT + JWKS.
  Infrastructure only: no business logic goes here; FastAPI stays the only product server.
- **apps/desktop**: Tauri 2 shell (Rust) loading the `apps/web` bundle — durable native SQLite,
  tray, native notifications. Phase A scaffolded (stable); Phase B (native PowerSync, alpha) is a
  guide in `docs/desktop.md`. NOT built in CI/sandbox (needs Rust + WebKitGTK dev libs). Optional.
- **infra**: docker compose (postgres + powersync service), `infra/powersync/sync-rules.yaml`.

## Commands

- `make db` / `make db-down` — start/stop dev Postgres (host :15432) + PowerSync (host :18080)
- `make api` — run FastAPI dev server (uvicorn, :18000)
- `make auth` — run better-auth service (:13001)
- `make web` — run Vite dev server (:15173)
- `make test` — API tests (pytest) + web typecheck
- `make e2e` — boot the full stack + run the Playwright E2E suite (the per-feature "done gate"; see `docs/e2e.md`)
- Migrations: see `.claude/skills/db-migration`

## Conventions

- Python: ruff format + lint; full type hints; async everywhere in request paths.
- TS: strict mode; no `any`; components function-style; files kebab-case, components PascalCase.
- Schema changes touch three places, always together: SQLAlchemy model + Alembic migration +
  `apps/web/src/lib/powersync/schema.ts` (+ sync rules if a new table). The `sync-rules` skill
  documents this.
- Commits: conventional commits (`feat:`, `fix:`, `chore:`...), small and focused.

## Product guardrails

- Every feature must pass the **"does this add clutter?"** test (see `docs/planning/README.md`).
- Curated block set only; resist adding block types.
- The only ambient AI is the daily summary. Interactive AI is user-triggered only.

## Memory

Durable project decisions and lessons live in `.claude/memory/` (index: `MEMORY.md`). Record new
*non-obvious* decisions there (why, not what); don't duplicate what code or planning docs already
say.
