---
name: theming
description: How light/dark works — semantic colour tokens, why components must never name a raw shade, and the BlockNote coupling
metadata:
  type: project
---

Added 2026-08-04 (dark mode + theme toggle). The *why*, not the what.

- **Components name a ROLE, never a shade.** `tailwind.config.js` maps semantic colours
  (`app`, `surface`, `elevated`, `line`, `hover`, `fg`, `muted`, `subtle`, `danger`, `accent`,
  `on-accent`) onto CSS variables defined once per theme in `src/index.css`. So write
  `bg-surface text-muted`, never `bg-neutral-50 text-neutral-500` and never a `dark:` variant.
  Chosen over doubling every class with `dark:` — the original restyle replaced 202 hardcoded
  classes across 15 files, and a `dark:` pass would have made that ~400 and let the two themes
  drift. Values are space-separated RGB channels so Tailwind's `<alpha-value>` opacity
  modifiers (`bg-hover/40`) still work.
- **Three modes, and "system" is the default.** `src/stores/theme.ts` persists light/dark/system
  to localStorage and toggles `dark` on `<html>` (Tailwind `darkMode: "class"`, chosen over
  "media" precisely so an explicit choice can override the OS).
- **The anti-flash script in `index.html` is intentionally duplicated logic.** It applies the
  stored theme before first paint; the module bundle loads too late to prevent a white flash for
  dark-mode users. If the storage key (`tendto:theme`) or the class name changes, change it in
  BOTH places.
- **BlockNote does NOT follow the app automatically — this was the original bug.** Left alone,
  `BlockNoteView` picks its own theme from `prefers-color-scheme`, so an OS-dark user got a dark
  editor inside a light shell. It must be passed `theme={useThemeStore(s => s.resolved)}`
  (page-editor.tsx). Separately, its themes paint the editor *surface* (#1f1f1f in dark), which
  reads as a floating card against our near-black page while light blends invisibly — so
  `index.css` re-binds `--bn-colors-editor-background`/`-text` on
  `.bn-root.bn-container[data-color-scheme]`. That selector's specificity (0,3,0) deliberately
  beats BlockNote's own `.bn-container.dark` (0,2,0) so it wins regardless of bundle order.
- **`color-scheme` on `:root`/`.dark` is what themes native controls.** Checkboxes, `<select>`,
  and date pickers follow it for free; don't hand-style them.
- **Saturated status colours stay literal.** The kanban column palette in
  `lib/items/mutations.ts` (amber/emerald/sky/violet/rose) is data colour, readable on both
  themes. Only its neutral entry became `bg-subtle`.

See [[local-dev-setup]] for the trap that editing `tailwind.config.js` needs a Vite restart.
