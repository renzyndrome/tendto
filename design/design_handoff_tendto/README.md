# Handoff: TendTo — Local-first Notes App Screens

## Overview
TendTo is a clutter-free, local-first Notion alternative ("instant like Obsidian, synced like Notion"). This handoff covers the core screen set: the document editor (3 visual directions, with **Meadow (1a)** as the lead direction), a Kanban board view for macro tasks, theme settings, first-run onboarding (welcome dialog + coach-mark tour), and a mobile PWA editor view. Desktop-first; mobile is delivered as a PWA.

## About the Design Files
The file in this bundle (`TendTo Screens.dc.html`) is a **design reference created in HTML** — a static mockup canvas showing intended look and behavior, not production code to copy directly. Your task is to **recreate these designs in the target codebase's existing environment** (React, Vue, Svelte, Tauri/Electron shell, etc.) using its established patterns and libraries — or, if no codebase exists yet, choose the most appropriate stack for a local-first desktop-first PWA (e.g. React + a CRDT store such as Yjs/Automerge + IndexedDB persistence + a lightweight sync backend) and implement the designs there.

The HTML file is a "design canvas": multiple option cards stacked in turns. Each option has an id badge (1a, 1b, 1c, 1d, 1e, 2a, 2b, 2c). **Implement the Meadow direction (1a) unless told otherwise** — 1d, 1e, 2a, 2b, 2c are all drawn in Meadow. 1b (Studio) and 1c (Manuscript) are alternative explorations; treat their unique ideas (doc tabs, quick switcher, focus/status pill) as optional features, not styling to merge.

## Fidelity
**High-fidelity.** Colors, typography, spacing, radii and states are final for the Meadow direction. Recreate pixel-perfectly using your codebase's component library and conventions.

## Design Tokens (Meadow — lead direction)

Colors:
- Canvas / doc background: `#fbfaf7`
- Sidebar / panel background: `#f4f1ea`
- Ink (primary text): `#1f1d18`
- Body text: `#3b372f`
- Secondary text: `#5b564c`
- Muted / placeholder: `#8a857a`
- Faint / section labels: `#a39d90`
- Hairline borders: `rgba(31,29,24,.06–.10)`
- Border (inputs/cards): `rgba(31,29,24,.08)`
- Accent (Meadow green): `oklch(0.55 0.11 152)` ≈ `#33805b`; hover: `oklch(0.5 0.11 152)`
- Accent soft bg (selected rows, tags): `oklch(0.55 0.11 152 / .10–.12)`, text `oklch(0.4 0.09 152)`
- Sync dot: `oklch(0.62 0.13 152)`
- Dark surface (tooltips, dark-mode swatch): `#23211c`
- Alternative accents offered in settings: blue `oklch(0.55 0.11 250)`, terracotta `oklch(0.55 0.11 45)`, plum `oklch(0.55 0.11 320)`, mono `#3b372f`

Typography:
- UI + doc sans: **Albert Sans** (400/500/600/700), fallback system-ui
- Optional doc serif (settings + Manuscript direction): **Source Serif 4**
- Mono (code, kbd hints): `ui-monospace, Menlo, monospace`
- Scale: doc title 38/700 (-.02em); H2 22/600; body 15.5/1.65; sidebar items 13; secondary 12.5; meta 11.5; section labels 10.5/600, uppercase, +.08em tracking

Spacing & shape:
- Sidebar width 244px; doc column max-width 680px centered
- Radii: 7px (sidebar rows, buttons), 8px (inputs, segmented controls), 10px (cards, code blocks, board cards), 12–16px (tooltips/modals), 100px (pills)
- Row padding: 6px 10px; card padding 12px 14px
- Shadows: card `0 1px 2px rgba(31,29,24,.04)`; menu `0 10px 30px rgba(31,29,24,.12)`; modal `0 24px 60px rgba(31,29,24,.3)`; dragged card `0 14px 32px rgba(31,29,24,.2)`

## Screens / Views

### 1a — Editor (lead)
- **Layout**: 244px sidebar (`#f4f1ea`, right hairline) + doc area (`#fbfaf7`). Doc column 680px max, centered, 44px top padding.
- **Sidebar**: logo tile (22px, radius 7, accent bg, white "T") + "TendTo" wordmark; Search field (inset card style, ⌘K kbd hint right-aligned); nav items Home / Daily note / Settings (13px, secondary color, 7px-radius hover rows, `rgba(31,29,24,.05)` hover); "PAGES" section label; page tree with ▸/▾ disclosure chevrons, indent 28px for children; active page row uses accent soft bg + dark-green text, 500 weight; "+ New page" muted row; footer pinned bottom: green sync dot (7px) + "All changes saved · synced" 11.5px muted.
- **Top bar**: breadcrumb "Pages / Field Notes — July" (12.5px), right side: "Edited 2m ago" (11.5px faint), Share button (bordered, 7px radius), ⋯ overflow.
- **Blocks shown**: H1 title; paragraph; H2; to-do list (16px checkboxes, radius 5; checked = accent bg + white ✓ + strikethrough muted text); toggle block (▾ chevron + 600-weight label; children indented with 2px left border rail); code block (panel bg `#f4f1ea`, header row with filename in mono 10.5px + Copy action, 12.5px mono body, subtle syntax tint using accent hues).
- **Slash menu**: anchored below an empty block showing caret + "/". 264px popover, white, radius 10, menu shadow, 6px padding; "BLOCKS" section label; rows = 24px glyph tile (panel bg, radius 6) + 13px label; selected row uses accent soft bg; first row shows ↵ kbd hint. Items: Text, Heading 1, Heading 2, To-do list, Toggle, Code.

### 2a — Kanban board ("Season plan")
- **Layout**: same sidebar + top bar. Page header: 28px/700 title; below it a view switcher (segmented control: Board / Table / List — active segment white with 1px shadow), Filter and Sort text buttons, right-aligned primary button "+ New task" (accent bg, white, radius 8).
- **Board**: horizontal row of 236px fixed-width columns, 16px gap. Column header: 12px/600 name + count pill (faint, 100px radius) + "+" on hover-right. Cards: white, 1px hairline border, radius 10, subtle shadow, 12/14px padding; title 13px/500; optional tag pills (10px/500, 100px radius, accent soft or neutral), checklist progress "☰ 1/2" and due date in 10.5px faint; overdue/near dates tinted terracotta.
- **Drag state**: dragged card rotates 2.5°, accent border, large shadow, `cursor: grabbing`; drop target = 64px dashed placeholder (1.5px dashed accent at 55% alpha, accent 6% fill, radius 10).
- **Done column**: cards use canvas bg, fainter border, strikethrough muted titles; "Show 4 more…" collapse row.
- Board / Table / List are views over the same task data (Notion-style database views).

### 1d — Theme settings (Appearance)
- **Layout**: 190px settings nav (panel bg; items Account / **Appearance** / Sync & storage / Shortcuts / Import-export; active = accent soft bg) + body (26/30px padding).
- **Header**: "Appearance" 18px/600 + caption "Applies on this device instantly — synced to your other devices."
- **Mode**: three preview cards (Light / Dark / System) — mini skeleton thumbnails, selected card gets 2px accent border + accent dot next to label.
- **Accent**: 28px circular swatches (green/blue/terracotta/plum/mono); selected swatch has 2px ink outline offset 3px; name label beside.
- **Document type**: three cards with "Ag" specimen (Sans / Serif / Mono); selected = 2px accent border.
- **Density** (Comfortable/Compact) and **Editor width** (Narrow/Full): segmented controls, active segment = white pill with shadow.
- Persist per-device with sync of the preference object; apply live without reload.

### 2b — Welcome dialog (first launch)
- Dimmed (`rgba(31,29,24,.28)`) + slightly blurred editor behind. 440px centered modal, white, radius 16, modal shadow.
- Content: centered 44px logo tile; "Welcome to TendTo" 21px/700; subcopy about local-first; three feature rows (30px accent-soft icon tile + 13px/600 title + 12px muted caption): Instant, always / Jump anywhere (⌘K) / Blocks on demand (/).
- Actions: full-width primary "Take the 1-minute tour" (accent, radius 9) + text button "Skip — start writing". Progress: 4 dots (step 1 active = ink).

### 2c — Coach-mark tour step
- Editor rendered at ~45% opacity except the spotlit block: an empty block styled as white field with 1.5px accent border + 5px accent-glow ring (`0 0 0 5px accent/14%`), placeholder "Type / for blocks…".
- Tooltip below-left, 300px, dark surface `#23211c`, radius 12, arrow notch; "STEP 2 OF 4" eyebrow in light green; 14px/600 title; 12.5px body with inline kbd chip; footer: Back (left), Skip tour + primary Next (right).
- Tour has 4 steps; wire Back/Next/Skip; remember completion (never auto-show again).

### 1e — Mobile PWA editor (390px)
- Status bar, then compact top bar: back chevron, doc title 13px/500, sync dot, ⋯ menu.
- Doc: title 27px/700, body 15px/1.65, to-dos with 18px checkboxes. **All tap targets ≥ 44px.**
- Block toolbar pinned above the keyboard: 44×40px buttons — insert (+, bordered), Aa (text style), ✓ (to-do), ▸ (toggle), {} (code), dismiss-keyboard (⌄) right-aligned.
- PWA: installable, offline-first (service worker + local store); keyboard-safe-area handling.

### Alternative directions (reference only)
- **1b Studio**: cool slate palette (`#f2f4f7` / `#e9edf1`, ink `#15181d`, blue accent `oklch(0.6 0.14 255)`, Archivo type), 52px dark icon rail (`#1b1e24`) + 224px page-list panel + doc tabs; includes the **quick switcher** (⌘K): 520px modal, search row with esc chip, results with match highlighting, "Create page" row with ⌘↵, footer kbd legend. The quick switcher pattern should ship in the lead direction too.
- **1c Manuscript**: chrome-free serif reading canvas (Source Serif 4 17.5/1.75, terracotta accent `oklch(0.58 0.11 45)`, blockquote with 3px accent rail on 7% accent bg) + floating bottom status pill (Saved locally · word count · Outline · Focus). The status pill and Focus mode are good candidates for the lead direction's "Focus" feature.

## Interactions & Behavior
- **Editing**: block-based editor; Enter creates a block, `/` opens the slash menu at the caret (filter as you type, ↑↓ + ↵ to select, esc closes). Toggles expand/collapse. Checkbox click toggles done (strikethrough + muted).
- **Quick switcher**: ⌘K opens; fuzzy match with highlighted substrings; ↵ opens, ⌘↵ creates page named by the query; esc closes.
- **Hover states**: sidebar/menu rows get `rgba(31,29,24,.05)` bg; bordered buttons get `rgba(31,29,24,.04)` bg; muted glyphs darken to ink; cards darken border to `rgba(31,29,24,.2)`.
- **Kanban**: drag to reorder/move cards (see drag state above); optimistic local reorder, sync in background.
- **Sync UX (deliberately subtle)**: never modal, never blocking. Green dot + "All changes saved · synced" in sidebar footer; mobile shows dot only. States: synced (green), syncing (pulse), offline ("Saved locally — will sync"). No conflict dialogs — CRDT merge.
- **Local-first**: every keystroke persists locally first (target < 16ms perceived latency); app fully usable offline.
- **Onboarding**: welcome dialog on first launch only → 4-step coach-mark tour (step 2 shown); Skip available everywhere; completion stored locally + synced.
- **Transitions**: keep minimal — popovers/tooltips fade+4px rise ~120ms ease-out; no page transitions.

## State Management
- Page tree (nested pages, expanded/collapsed state), active page, recent pages (for switcher ranking).
- Document model: ordered block list (type, content, props e.g. checked, collapsed, language).
- Board: tasks with status column, tags, due date, checklist items; view type per page (board/table/list).
- Preferences: mode (light/dark/system), accent, doc typeface, density, editor width — per device, synced.
- Sync status: synced | syncing | offline; onboarding: welcomed flag, tour step.

## Assets
- No external images. Logo is a rounded square tile with a white "T" — replace with the real mark when available.
- Fonts from Google Fonts: Albert Sans, Source Serif 4 (plus Archivo only if building 1b). Self-host for offline-first.
- Icons in the mocks are text glyphs (placeholders) — substitute a proper icon set (e.g. Lucide/Phosphor, 1.5px stroke, muted color) for: home, pencil, gear, search, chevrons, plus, overflow, checkmark.

## Files
- `TendTo Screens.dc.html` — the full design canvas. Option ids: 1a editor (lead), 1b Studio + quick switcher, 1c Manuscript, 1d theme settings, 1e mobile PWA, 2a Kanban, 2b welcome dialog, 2c coach-mark tour. Open it in a browser; every style is inline on the elements, so you can inspect any node for exact values.
