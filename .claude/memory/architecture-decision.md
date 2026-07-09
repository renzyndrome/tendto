---
name: architecture-decision
description: Why TendTo is sync-engine local-first (PowerSync), not cloud-first and not Yjs CRDTs
metadata:
  type: project
---

Decided 2026-07-09 after evaluating three models (full history in docs/planning/02):

1. Cloud-first (rejected): simplest, but every interaction waits on the network — rebuilds
   Notion's sluggish feel. Instant-feel was promoted from nice-to-have to pillar ("it's why
   Obsidian feels instant") — that made this structural, not fixable with caching.
2. Yjs/CRDT local-first (rejected as starting point): the original plan; front-loads the
   hardest engineering (CRDT substrate, Node sync server) to win only character-level
   co-editing, which isn't a requirement.
3. **PowerSync sync engine (chosen)**: local SQLite replica per device (instant + offline),
   Postgres source of truth, writes validated by FastAPI (`/sync/upload`), engine bought not
   built. Most production-tested engine per 2026 comparisons; ElectricSQL is the fallback.

**Why:** delivers both real requirements (every-device sync + Obsidian-instant) while keeping
an all-Python authoritative server.

**How to apply:** never propose hand-rolled sync/WebSocket content channels or CRDTs; conflicts
are row-level LWW; per-page Yjs is the only sanctioned co-editing upgrade path and must be
explicitly earned. Exit ramps: data is plain rows in our Postgres, so engine swap or cloud-first
fallback never changes the schema. See [[settled-decisions]].
