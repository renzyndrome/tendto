# 07 — Recommended Tech Stack & Build Path

The one-page capstone: the **full recommended stack** for TendTo and the **end-to-end build path**.
Detail lives in docs 02–06; this is the at-a-glance view. **No open decisions remain.**

The model in one line: **local-first reads (instant, offline, Obsidian-feel) + authoritative
writes (FastAPI validates everything into Postgres) + a bought sync engine (PowerSync) in between.**

---

## A. The recommended stack (every layer)

| Layer | Recommendation | Why / ref |
| --- | --- | --- |
| **Product model** | **Sync-engine local-first** — SQLite replica per device; Postgres source of truth; writes via FastAPI | Instant + offline by construction; sync bought, not built (doc 02 §A) |
| **Sync engine** | **PowerSync** (managed to start; self-host container later). Alternative: ElectricSQL | Most production-tested in 2026; SQLite on every platform; upload queue targets *your* API (doc 02) |
| **UI core** | **React 19 + TypeScript**, **Vite** SPA — shipped as a **responsive web app / PWA** | One codebase on every device from day one (doc 02 §B, doc 04) |
| **Block editor** | **BlockNote** (ProseMirror/TipTap; Notion-style) | Notion-feel editor; persists blocks as rows in the local replica |
| **Local data** | **SQLite** via the PowerSync client (wasm/OPFS web; native in shells) + reactive queries | The instant/offline substrate — and the UI's state layer |
| **Routing / API-state** | **TanStack Router** + thin **TanStack Query** (auth/billing/AI calls only) | Content state lives in SQLite, not Query |
| **Local UI state** | **Zustand** (light) | Sidebar, modals, settings |
| **Styling** | **Tailwind CSS** + **Radix/shadcn** | Fast, calm, accessible — fits clutter-free |
| **Backend** | **FastAPI** — the authoritative write path (upload endpoint), permissions, tenancy, scheduled jobs | All-Python server; your strength owns the trust boundary (doc 02) |
| **Database** | **Postgres** — **Supabase** to launch (first-class PowerSync pairing; Neon/managed later) | Source of truth; RLS multi-tenancy (doc 05) |
| **Vector search** | **pgvector** (same Postgres); local SQLite **FTS** for instant search | Semantic later, instant now (doc 03, 06) |
| **Object storage** | **S3-compatible** (MinIO self-host / cloud bucket) | Images, attachments |
| **Auth** | **better-auth** (self-hosted, organization + JWT plugins) as a tiny Node auth service on *our* Postgres; its JWTs (verified via its JWKS endpoint) authenticate FastAPI **and** the sync client. WorkOS later for enterprise SSO | Orgs/invites without per-user/per-org pricing; zero auth vendor cost at scale (doc 05) |
| **Desktop shell** | **None at launch — the PWA.** Tauri 2 wrapper later *if earned* (native SQLite durability is the real rationale) | Packaging, not architecture (doc 04) |
| **Mobile shell** | **None at launch — the responsive PWA.** Capacitor or RN + Expo later *if earned* (PowerSync has SDKs for both). **Not Flutter** | Decide on real pain (doc 04) |
| **Conflicts** | Block/row granularity; **last-write-wins** + "updated elsewhere" notice; Yjs **per page** only if live co-editing is ever earned | The honest trade (doc 02 §A) |
| **AI** | Routed models via a FastAPI-side router · pgvector RAG · BYO-key / **Ollama** self-host option · **TendTo MCP server** | Daily summary + summarize + search (doc 06) |
| **Billing (public)** | **Stripe** (per-seat for company groups) | Public multi-tenant SaaS |
| **Email** | **Resend / Postmark** | Invites, verification, summary delivery |
| **Hosting** | FastAPI container + managed Postgres + PowerSync (cloud → self-host) + object store; one `docker compose` self-host path | Cheap, boring, no-lock-in story intact |

---

## B. The build path (end to end)

Each phase has a clear "done." Infra comes online exactly when the product needs it — nothing early.

| Phase | Product milestone | Infra / stack added | AI |
| --- | --- | --- | --- |
| **0 — Prove the sync loop** *(throwaway spike)* | Instant local editing; edit appears on a second device in ~1s; **offline edit merges cleanly on reconnect** | BlockNote + PowerSync (cloud) + FastAPI upload endpoint + Postgres | — |
| **1 — MVP: instant tasks everywhere** | WYSIWYG editor, notes-by-category, simple to-dos; **responsive PWA on laptop + phone**; **instant + offline + synced, all structural** | **Supabase Postgres**, **better-auth** service (JWT/JWKS → API + sync engine), sync rules, deployed API | — |
| **2 — Collections & collaboration** | **Checklist / list / table / board (kanban)**; startup task workflow; **shared workspaces + roles** (sync rules ↓, FastAPI ↑); live teammate updates + presence; **comments & @mentions**; templates | Invitations, memberships, RLS hardening, presence channel | — |
| **3 — Organize + intelligence** | **Calendar** + **unified calendar** (instant local query); **instant search** (SQLite FTS); export + self-host path | Sync hardening (long-offline, conflicts); backup/restore drill; **pgvector**; SSE streaming | **Daily summary** + **per-page summarize** + inline AI (BYO/self-host model option) |
| **4 — Shells & earned extras** | Native shells *if earned* (Tauri wrapper — durable native SQLite; mobile per doc 04); nice-to-haves one at a time (incl. per-page Yjs co-editing *if earned*) | Optional shells | **TendTo MCP server**; semantic Q&A |

**Runs in parallel from Phase 2 onward (going public):** multi-tenant **RLS** isolation, **Stripe**
billing, transactional **email**, rate-limiting, and GDPR-style export/delete (doc 05 §4).

> **Where this actually stands (2026-08-17).** Phases 0–2 are shipped, and Phase 3's headliners
> with them: the sync loop, MVP editor + PWA, collections in four views, shared workspaces with
> invitations, the unified calendar, instant search, export, and the daily AI summary. Transactional
> **email** arrived early (with invitations) as a provider-agnostic port with an offline fallback,
> so no key is needed in dev.
>
> Still open, and each needs live services or its own infra pass: **presence**,
> **comments/@mentions**, **RLS hardening**, **pgvector** semantic search, **Stripe**, the
> backup/restore drill, and the scheduled delivery of the daily summary. Phase 4 (native shells)
> is untouched by design — see [`.claude/memory/current-state.md`](../../.claude/memory/current-state.md)
> for the running build state and open engineering items.

---

## C. Start here

**Phase 0 is still small — a weekend or two** — because the sync engine is bought, not built.
Scaffold FastAPI + Postgres (Supabase), point a PowerSync instance at it with one sync rule, drop
BlockNote into a Vite page persisting blocks to the local replica, and run the two tests: the
~1-second cross-device update, and the airplane-mode merge. If both pass, every promise in this
plan — instant, offline, synced everywhere — is proven, and the rest is execution in a stack where
the only new skill is React.

## Related docs

[01 — Features](./01-feature-comparison.md) · [02 — Architecture](./02-architecture-and-stack.md) ·
[03 — Roadmap](./03-roadmap.md) · [04 — Platforms](./04-mobile-strategy.md) ·
[05 — Database & Multi-Tenancy](./05-database-and-multitenancy.md) · [06 — AI Layer](./06-ai-layer.md)
