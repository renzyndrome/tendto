---
name: settled-decisions
description: Do-not-relitigate list — stack choices with one-line whys
metadata:
  type: project
---

Settled in docs/planning (2026-07-09). Don't reopen without Renzy asking:

- **TanStack Router, NOT TanStack Start / Next.js** — content renders from the local replica
  (nothing to SSR); FastAPI owns the server role; PWA/Tauri need a static Vite bundle.
- **All-Python backend (FastAPI)** — no Node services; dropping the Yjs plan removed the only
  Node component. Plays to Renzy's backend strength; React is the deliberate learning area.
- **BlockNote without its Yjs collab mode** — blocks persist as rows in the replica.
- **PWA first; no desktop/mobile shells at launch** — Tauri later only if earned (real
  rationale: durable native SQLite vs evictable browser OPFS). Never Flutter (discards the
  editor + shared TS core).
- **Supabase for Postgres at launch** — first-class PowerSync pairing; portable to Neon/plain
  Postgres since it's all just Postgres. Clerk for auth (JWTs double as sync credentials).
- **Conflicts: row-level LWW** + "updated elsewhere" notice; per-page Yjs only if co-editing
  is ever earned. See [[architecture-decision]].
- **Product guardrails:** clutter test on every feature; curated block set; only ambient AI is
  the daily summary (doc 06).
