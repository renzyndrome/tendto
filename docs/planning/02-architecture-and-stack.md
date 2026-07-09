# 02 — Architecture & Stack

Two decisions dominate everything else: **the sync model** and **the platform strategy**.
Both are made here, with reasoning and the roads not taken.

---

## A. The sync model: local-first reads, authoritative writes (a sync engine)

### Your real requirements — both of them

1. *"Track my tasks on whatever device I access this app"* — **multi-device cloud sync.**
2. *"Instant, the way Obsidian feels"* — **zero network wait on the interaction path.** Obsidian is
   instant because every read/write hits local disk; Notion waits on the network. This is a
   structural property, not a polish item — so it must be chosen in the architecture, not
   retrofitted with caching.

### The options considered

1. **Cloud server-authoritative.** Postgres is the source of truth; clients fetch over the network.
   Simplest to build — but every cold load, page switch, and search waits on the network. Rejected:
   it rebuilds Notion's feel, and "instant" was re-evaluated up from nice-to-have to pillar.

2. **Full local-first on CRDTs (Yjs).** Conflict-free merges by construction; the original version
   of this plan. Instant and offline — but front-loads the hardest engineering: a CRDT substrate, a
   Node sync server (Hocuspocus), binary blob persistence, a second mental model. Its unique win
   (character-level co-editing of the same paragraph) isn't on the requirements list. Rejected as a
   *starting point*; available later per-page if live co-editing is ever truly needed.

3. **A sync engine — local replica + authoritative server (chosen).** Each device keeps a **local
   SQLite replica**; a production sync engine keeps replicas and Postgres in agreement. Reads are
   local (Obsidian-instant, fully offline); **Postgres remains the single source of truth**, and
   **every write is validated by FastAPI** before it lands there. We buy the sync machinery
   instead of building it.

### The engine: PowerSync (ElectricSQL as the alternative)

**PowerSync** is the most production-tested engine in the 2026 field: bidirectional
**Postgres ⇄ client-SQLite** sync — server data flows down via declarative **Sync Rules** (bucketed
per user/workspace), client writes flow up through a persistent **upload queue** that calls *your*
backend (`uploadData()` → FastAPI). SQLite runs everywhere: **wasm/OPFS in the browser**, native
SQLite in any future desktop/mobile shell — one storage story on every platform (this also answers
"should the desktop app use SQLite?" — yes, and so does every other platform, via the engine).

**ElectricSQL** (+ TanStack DB) is the watch-list alternative: elegant read-path sync ("Shapes")
with writes through your API by design, but rougher production edges as of early 2026. The
architecture below fits either; naming one avoids re-litigating it every sprint.

### How sync actually works (the whole model)

```
        device A                     device B
   ┌────────────────┐          ┌────────────────┐
   │ React SPA      │          │ React SPA      │
   │  ↕ instant     │          │  ↕ instant     │
   │ local SQLite ──┼── sync ──┼── local SQLite │
   └───────┬────────┘  stream  └────────────────┘
           │ upload queue            ▲
           ▼                         │ sync rules (per-workspace buckets)
       FastAPI  ── validates, ──►  Postgres  ──►  PowerSync service
                   permissions      (source of truth)
```

- **Reads:** always from local SQLite. Opening the app, switching pages, filtering a board, search —
  all instant, all fully offline.
- **Writes:** applied to local SQLite immediately (the UI never waits), queued, uploaded to
  FastAPI, which enforces permissions/validation and writes Postgres. Confirmed state streams back
  down to **all** the user's devices — and to teammates' devices in shared workspaces. That stream
  *is* the live-update channel; no hand-rolled WebSocket layer.
- **Offline:** not a mode — the replica is simply there. Edit on a plane; the queue uploads on
  reconnect.
- **Conflicts — block granularity, stated honestly.** Blocks and items are rows, so concurrent
  edits to *different* blocks/tasks never conflict. Two offline edits to the *same* block resolve
  **last-write-wins** in FastAPI (with `updated_at` checks and a visible "updated elsewhere"
  notice). That's the right trade for a personal tool + small team. Character-level co-editing of
  one paragraph is the single case LWW handles worse than CRDTs — deferred; if ever needed, add
  **Yjs per active page** on top (the engine still syncs everything else).

### The trade-offs, stated honestly

- **One more moving part:** the PowerSync service (managed cloud or self-hosted container) sits
  next to FastAPI. Cost of buying sync instead of building it — far cheaper than owning a CRDT
  substrate.
- **Engine dependency:** mitigated by the exit ramp — data is plain rows in *your* Postgres and
  plain SQLite on device; swapping engines (or falling back to cloud-first REST) doesn't change the
  schema or the FastAPI write path.
- **New-device first open** needs an initial sync (progressive: current workspace first).
- **Browser storage durability:** OPFS/IndexedDB can be evicted by the browser under pressure —
  harmless (the cloud has everything; re-sync) but it's the one honest reason a **desktop shell
  with native SQLite** may eventually be worth shipping (doc 04).

### Collaboration in this model

Sharing and roles are rows: `memberships(user, workspace, role)`. Enforcement happens twice, at the
right boundaries: **sync rules** decide *what flows down* to a device (only workspaces you belong
to), and **FastAPI** decides *what gets written* (role checks on every upload). Teammates' changes
appear live via the same sync stream. Presence ("who's viewing this page") is ephemeral, not data —
a small WebSocket/presence channel added in Phase 2, deliberately optional. Comments and @mentions
are ordinary rows that sync like everything else.

### The default AI feature: end-of-day summary — where it runs

A scheduled job in FastAPI (once each evening per user) reads the day's task/page activity — plain
SQL over Postgres, which holds everything — asks an LLM to summarize, and delivers a calm daily
note. Model choice is a setting: hosted API by default, or self-hosted/local (Ollama). One toggle
to disable. (Details: doc 06.)

---

## B. The stack

### The shape: one web app, one API, one sync service

```
        ┌───────────────────────────────────────────────┐
        │  React + TypeScript SPA (Vite) + BlockNote     │
        │  reads/writes local SQLite (PowerSync client)  │
        │  — responsive web app / installable PWA —      │
        └───────────────────────────────────────────────┘
              │ upload queue                ▲ sync stream
        ┌─────┴─────────────┐      ┌────────┴──────────┐
        │  FastAPI          │      │ PowerSync service │
        │  (validation,     │      │ (managed or       │
        │   permissions,    │      │  self-hosted)     │
        │   AI summary job) │      └────────┬──────────┘
        └─────┬─────────────┘               │ logical replication
              └────────►  Postgres  ◄───────┘
                     (+ pgvector)      S3-compatible store
                     source of truth   images & attachments
```

### Layer-by-layer

| Layer | Recommendation | Why |
| --- | --- | --- |
| **Block editor** | **BlockNote** (MIT core, ProseMirror/TipTap, Notion-style) | Notion-feel editor with drag-blocks and `/` commands. Persists blocks as rows in the local replica (debounced); no Yjs collab mode. |
| **UI framework** | **React + TypeScript**, **Vite** SPA | BlockNote is React-first; React is the frontend you're learning. No Next.js — nothing to SSR in a local-reading app. |
| **Local data / sync** | **PowerSync client** — SQLite (wasm/OPFS on web, native in shells) | The heart of the model: instant reads, offline writes, live sync. Reactive queries drive the UI. |
| **Server cache glue** | **TanStack Query** (thin) | Only for the few true API calls (auth/billing/AI). Content state lives in SQLite, not Query. |
| **Routing** | **TanStack Router** (or React Router) | Type-safe SPA routing. **Not TanStack Start** (and not Next.js): Start's value is a server runtime — SSR, server functions — but content renders from the *local replica* (nothing to SSR), FastAPI already owns the server role, and the PWA/Tauri deployable is a static Vite bundle. Start only makes sense in a full-stack-TS world without FastAPI. |
| **Local UI state** | React built-ins + **Zustand** (light) | Sidebar, modals, settings. |
| **Styling** | **Tailwind CSS** + **Radix/shadcn** | Fast, calm, accessible — fits clutter-free. |
| **API** | **FastAPI** | The authoritative write path (`uploadData` target), permissions, tenancy, scheduled jobs — your strongest language owns the server. |
| **Sync service** | **PowerSync** (cloud to start; self-host container for the no-lock-in story) | Buys the hardest 20% of the product. |
| **Database** | **Postgres** (Supabase to start — PowerSync has first-class Supabase integration) + **pgvector** | Source of truth; RLS multi-tenancy (doc 05). |
| **Auth** | **Clerk** (doc 05); PowerSync authenticates clients via JWT | Orgs/invites out of the box. |
| **Object storage** | **S3-compatible** (MinIO self-hosted, or a cloud bucket) | Images, attachments. |

### The data model (relational, one primitive — unchanged by the sync engine)

- **Workspace** → **pages** (a tree) and **collections**.
- **Page** = ordered **blocks** (`blocks`: id, page_id, type, JSON content, position).
- **Collection** = **items** with a JSONB `properties` bag. The *same* collection renders as
  **checklist, list, table, kanban, or calendar** — views are projections.
- **Unified calendar** = one query over date-bearing items across collections — and since the
  replica is local SQLite, it's an *instant, offline* query.
- **IDs are client-generated UUIDs and every row carries `updated_at`** — writes are idempotent and
  conflicts detectable. (These rules survived every version of this plan; they're what make the
  architecture swappable.)

### Where your skills land

- **Python (your strength):** the entire server — validation, permissions, tenancy, AI job.
- **React (your growth area):** the whole client, driven by reactive SQLite queries — a friendly
  surface: components render local data; the engine handles the distributed-systems part.
- **New, but bought not built:** the sync engine — configuration and sync rules, not protocol code.

---

## C. One-paragraph summary

Build **local-first with an authoritative server**: every device keeps a **SQLite replica** (instant,
Obsidian-feel, fully offline), **Postgres remains the single source of truth**, and **PowerSync**
keeps them in agreement — reads stream down via per-workspace sync rules, writes upload through
**FastAPI**, which validates and persists. Conflicts resolve at block granularity (different blocks
never conflict; same-block is last-write-wins), teammates' changes arrive over the same sync stream,
and the daily AI summary is a SQL-reading scheduled job. One **Vite + React + BlockNote** PWA covers
every device; the server is all-Python. The exit ramps are real: plain rows in your Postgres, Yjs
per-page if live co-editing is ever earned, engine swap without schema change.

## Sources

- [ElectricSQL vs PowerSync vs Zero — local-first sync engines (2026)](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026) · [PowerSync: offline-first sync for Postgres](https://queryplane.com/blog/powersync-offline-first-sync/) · [The architecture of local-first web development (2026)](https://www.smashingmagazine.com/2026/05/architecture-local-first-web-development/) · [The spectrum of local-first libraries](https://tolin.ski/posts/local-first-options)
- [BlockNote](https://www.blocknotejs.org/) · [Rich text editor frameworks 2026](https://velt.dev/blog/best-rich-text-editors-react-comparison)
