# 01 — Feature Comparison: Notion, Obsidian & the Open-Source Field

Goal: understand what to **adopt**, what to **reject**, and which **gaps** are worth owning.
All product facts here are current as of June 2026 (sources at the bottom).

## 1. Side-by-side

| Dimension | **Notion** | **Obsidian** | **Our target** |
| --- | --- | --- | --- |
| Core data model | Everything is a block; pages nest; databases are first-class | Plain `.md` files in a local folder; links form a graph | Block-based pages + just-enough databases — a local replica on every device, source of truth in the cloud |
| Editor | Polished WYSIWYG block editor | Markdown-first (live preview), not true block-WYSIWYG | True WYSIWYG block editor, Notion-feel |
| Databases / views | Strong: table, board (kanban), calendar, gallery, timeline | **Bases** (early 2026): list, table, card, gallery, map — newer, lighter | One collection, many views: **checklist, list, table, board (kanban), calendar** — opinionated, not endlessly configurable |
| Kanban | Yes, mature | Via Bases or community Kanban plugin | Yes, first-class, minimal config |
| Sync across devices | Cloud, automatic, account-based | First-party Sync add-on (~$5/mo) or DIY (git/cloud folder) | **Automatic, account-based, built-in** (sync engine). Sign in anywhere, everything's there, zero setup |
| Offline / speed | Limited offline: databases only first ~50 rows; every interaction waits on the network | **Excellent** — files are local, everything instant | **Excellent** — local replica on every device: instant reads, full offline read/write, conflicts managed |
| Collaboration | Strong (multi-cursor, comments) | Limited / not core | Calm sharing: shared workspaces, live updates, comments — without the notification noise |
| Platforms | Web, macOS, Windows, iOS, Android | macOS, Windows, Linux, iOS, Android | **Web app / PWA everywhere from day one**; optional desktop wrapper and native mobile shell later |
| Extensibility | Closed; API + integrations | **4,300+ community plugins**, open formats | Curated, minimal extension surface (avoid plugin sprawl) |
| Data ownership | Cloud-hosted, proprietary; export exists | **You own the files** | Cloud-hosted **but self-hostable** and fully exportable — open formats, no lock-in |
| AI | Deep, but paid add-on, always ambient | Via plugins (bring-your-own) | Ambient **daily summary** (default) + on-demand per-page summarize; bring-your-own or self-hosted model option |
| "Clutter" | High — feature sprawl, can feel slow | Low by default, but plugins re-introduce clutter | **Lowest** — opinionated defaults, progressive disclosure |

## 2. What each does well (adopt) and badly (reject)

**Notion — adopt:** the block-based WYSIWYG feel, first-class databases with multiple views, the
single fluid "type `/` to insert anything" interaction, clean templates — and its zero-setup,
account-based "my tasks on every device" sync *experience*.
**Notion — reject:** the *architecture behind* that experience — server-authoritative, so every
interaction waits on the network and offline degrades badly. Also: the cluttered surface, AI bolted
everywhere, lock-in without a self-host or clean-export story.

**Obsidian — adopt:** **local files are why it feels instant** — reads and writes never touch the
network. That property is adopted structurally (a local replica per device), not imitated with
caching. Plus: no-nonsense calm, open formats as an *export* philosophy.
**Obsidian — reject:** markdown-first editing (not the WYSIWYG block feel), young database story,
sync as a paid add-on — precisely the friction we refuse to have.

## 3. The open-source field — know it before you build

Three projects already chase "open-source Notion": **AppFlowy** (Rust + Flutter, local-first),
**AFFiNE** (web-tech, Yjs CRDTs, docs + whiteboard), and **Anytype** (P2P, encrypted, object-graph).
All three validate local-first as the right feel — and all three **hand-built their sync machinery**
(custom CRDT substrates, custom protocols) and paid for it in years of engineering and slower
feature velocity.

**Strategic implication:** the "open Notion" niche is occupied, and its occupants are busy owning
sync engines. Raw feature parity is *not* a differentiator — and neither is re-fighting their
sync-engineering battle solo. Your wedge is **focus and calm** for a specific workflow (personal
to-dos + a small startup's tasks + categorized notes), shipped fast by **buying the sync layer**
(a production sync engine, doc 02) and spending the saved years on the product surface.

## 4. The gaps worth owning

1. **Truly clutter-free by design.** Notion's biggest weakness in daily use is cognitive load. An
   opinionated, progressively-disclosed UI is a real, defensible difference.
2. **Obsidian's feel *and* Notion's sync *and* WYSIWYG — the sweet spot none of the big two hit.**
   Notion gives WYSIWYG + sync but not instant/offline; Obsidian gives instant/offline but not
   block-WYSIWYG, and charges for sync. A local replica per device + a sync engine delivers all
   three.
3. **Self-hostable and exportable.** One `docker compose up` self-host path plus honest full export
   (your data is plain rows and plain SQLite) is a stance none of the big players take.
4. **A workflow, not a toolbox.** Strong default templates for the core use cases so a new user is
   productive in minutes, not after an afternoon of configuration.
5. **Collaboration that stays calm.** Shared workspaces, live updates, and comments for a small
   team — without the activity-feed and notification noise.

## 5. Nice-to-haves (deliberately deferred)

Real-time character-level co-editing (live block-level updates ship first; Google-Docs-style
cursors must earn their complexity — per-page Yjs is the upgrade path, doc 02) · *broader* AI
beyond the daily summary · web clipper · public publishing · third-party API ·
timeline/Gantt/gallery/map views · end-to-end encryption · graph view · granular permissions, audit
logs, SSO/SCIM · activity feeds & notification systems.

**None of these belong in the MVP.** Each must earn its place later, behind the clutter test in the
README.

## Sources

- [Notion offline mode & limitations (2026)](https://notionbackups.com/guides/notion-offline-mode) · [Notion review 2026](https://hackceleration.com/notion-review/) · [Notion release notes](https://releasebot.io/updates/notion)
- [Obsidian roadmap](https://obsidian.md/roadmap/) · [Obsidian review 2026](https://www.lindy.ai/blog/obsidian-review) · [Obsidian pricing 2026](https://aiproductivity.ai/blog/obsidian-pricing/)
- [Notion vs Obsidian 2026](https://tech-insider.org/notion-vs-obsidian-2026/)
- [AFFiNE vs AppFlowy vs Anytype 2026](https://affine.pro/blog/affine-vs-appflowy-vs-anytype) · [Best open-source Notion alternatives 2026](https://www.bestalternative.dev/en/blog/best-notion-alternatives-2026-affine-appflowy-anytype-comparison)
