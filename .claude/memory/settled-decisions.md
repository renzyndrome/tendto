---
name: settled-decisions
description: Do-not-relitigate list — stack choices with one-line whys
metadata:
  type: project
---

Settled in docs/planning (2026-07-09). Don't reopen without Renzy asking:

- **TanStack Router, NOT TanStack Start / Next.js** — content renders from the local replica
  (nothing to SSR); FastAPI owns the server role; PWA/Tauri need a static Vite bundle.
- **FastAPI is the only product server** (amended 2026-07-09, was "no Node services") — all
  business logic in Python. The one JS-runtime process is the better-auth service (`apps/auth`,
  Bun):
  commodity auth infrastructure like the PowerSync container, ~50 lines of config, never app
  logic. See [[auth-and-sync-redesign]].
- **BlockNote without its Yjs collab mode** — blocks persist as rows in the replica.
- **PWA first; no desktop/mobile shells at launch** — Tauri later only if earned (real
  rationale: durable native SQLite vs evictable browser OPFS). Never Flutter (discards the
  editor + shared TS core).
- **Supabase for Postgres at launch** — first-class PowerSync pairing; portable to Neon/plain
  Postgres since it's all just Postgres. **better-auth for auth** (self-hosted, same Postgres;
  its JWT-plugin tokens double as sync credentials via JWKS). Clerk dropped 2026-07-09 over
  scale pricing — see [[auth-and-sync-redesign]].
- **Conflicts: row-level LWW** + "updated elsewhere" notice; per-page Yjs only if co-editing
  is ever earned. See [[architecture-decision]].
- **Product guardrails:** clutter test on every feature; curated block set; only ambient AI is
  the daily summary (doc 06).
