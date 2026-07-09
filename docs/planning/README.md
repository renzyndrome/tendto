# TendTo — Strategic Planning

> Working name: **TendTo** — tend to your tasks, notes, and life.
>
> **Domain:** the target is **tendto.app** — currently registered (Nov 2025, via Dynadot, parked)
> and **expiring 2026-11-01**. Plan: make a marketplace/backorder offer and watch the expiry;
> meanwhile **tendto.io**, **tendto.co**, **usetendto.app**, and **gettendto.app** were unregistered
> as of 2026-07-09 — grab one as the interim domain before they go. (tendto.dev and tendtoapp.com
> are already taken.)

**TendTo** is a focused, **clutter-free**, **local-first** workspace for notes, to-dos, and lightweight
project management — **instant like Obsidian, synced everywhere like Notion**. Every device keeps a
local replica, so the app opens and responds with zero network wait; a sync engine keeps all your
devices and the cloud in agreement automatically.

This folder is the strategic plan. It captures the *decisions and the reasoning behind them*, not
implementation detail. Code-level specs come later.

## Documents

| Doc | What it covers |
| --- | --- |
| [01 — Feature Comparison](./01-feature-comparison.md) | Notion vs Obsidian (and the open-source field), where each is strong/weak, the gaps we can own |
| [02 — Architecture & Stack](./02-architecture-and-stack.md) | The sync-engine model (instant local reads, authoritative writes) plus the full stack |
| [03 — Roadmap](./03-roadmap.md) | Phased direction, de-risking order, and what *not* to build |
| [04 — Platform Strategy](./04-mobile-strategy.md) | Web/PWA first; when (and whether) to add desktop and native mobile shells |
| [05 — Database & Multi-Tenancy](./05-database-and-multitenancy.md) | Postgres as the source of truth, sync rules as the tenancy boundary, RLS, auth |
| [06 — AI Layer](./06-ai-layer.md) | The AI stack: daily summary, per-page summarize, RAG — kept calm |
| [07 — Stack & Build Path](./07-stack-and-roadmap.md) | **Start here for the summary** — the full stack and the end-to-end path |

## TL;DR — the three decisions that matter

**1. Positioning — compete on focus, not feature count.**
Notion is powerful but cluttered and slow-feeling; Obsidian is instant but markdown-first with a
learning curve. The open-source field (AppFlowy, AFFiNE, Anytype) already chases "Notion but open."
None of them win on *calm, opinionated simplicity* tuned for **personal to-dos + a small startup's
task management + categorized notes**. That curation — delivered at Obsidian speed — is the product.

**2. Sync — local-first reads, authoritative writes, via a sync engine.**
Every device keeps a **local SQLite replica**, so reads and edits are instant and fully offline —
that's *why Obsidian feels instant and Notion doesn't*, adopted as a pillar, not an optimization.
**Postgres in the cloud stays the single source of truth**: writes apply locally at once, queue, and
upload through the FastAPI backend, which validates them and persists; the engine
(**PowerSync**) streams confirmed changes back to every device. We buy the sync machinery instead
of building it — no hand-rolled CRDTs, no custom sync protocol
([doc 02](./02-architecture-and-stack.md)).

**3. Stack — React SPA + sync-engine client, all-Python server.**
**Vite + React + TypeScript + BlockNote** for the UI, shipped as a responsive web app / installable
PWA that runs on every device from day one, reading and writing the local replica. **FastAPI +
Postgres** own everything server-side: validation, permissions, tenancy, the daily AI summary. No
Node services; React remains the only new skill in the critical path.

## The use cases this plan is optimized for

- Personal to-do list (checklist) — **on every device, instant, online or offline**
- A weekly **kanban** task tracker
- Your startup's task management (shared, multi-member)
- Notes organized by category (plain block docs)
- Collection lists like **games or movies to watch**
- A **unified calendar** that overlays tasks, game sessions, and more
- **Sync across every device** — browser, Linux, Windows, phone — automatic and conflict-managed,
  with a full offline fallback because the data is already on the device

Underlying all of these is one idea borrowed from Notion: **a collection of items can be shown as a
checklist, list, table, kanban board, or calendar — and plain pages are just blocks.** Same data,
many views.

> **Core pillars:** clutter-free UX · **instant feel (local reads)** · multi-device sync ·
> full offline · collaboration that stays calm (sharing, live updates, comments — not
> activity-feed noise).

## One AI feature, on by default

The single AI capability that ships **on by default** is an **end-of-day summary** — a short recap of
your wins and task status, delivered as a calm daily note (one toggle to turn it off). It runs
server-side over your own data, with a self-hosted/local model option. See [doc 06](./06-ai-layer.md).

## Guiding principle

**Every feature must survive the "does this add clutter?" test.** When in doubt, hide it behind
progressive disclosure or leave it out. Speed and calm are features — and in this architecture,
speed is structural, not cosmetic.
