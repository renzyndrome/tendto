# 04 — Platform Strategy (Web, Desktop, Mobile)

**The web app *is* the product**; every other platform is a packaging decision. The sync engine
makes this cleaner, not harder: the PowerSync client runs SQLite everywhere — **wasm/OPFS in the
browser, native SQLite inside any future shell** — so instant + offline behavior is identical on
every platform. This doc says which packages are worth building, when.

## The default: one responsive web app / PWA, everywhere

The Vite + React SPA, made responsive and installable as a **PWA**, covers every device from
day one:

- **Desktop (Linux/Windows/macOS):** browser tab, or "install" from Chrome/Edge for a windowed,
  dock-launchable app.
- **Mobile (Android/iOS):** the same app, responsive; "Add to Home Screen" gives an icon and a
  fullscreen feel.
- **Zero extra codebases, zero app-store friction, instant updates for all users.**

This delivers the actual requirement — *tasks on whatever device you open, instantly, online or
offline* — in Phase 1, with no shell engineering at all. Everything below is optional polish,
deferred until the PWA proves insufficient in real daily use.

One honest caveat that shells eventually answer: **browsers may evict OPFS/IndexedDB storage**
under disk pressure. Harmless (Postgres has everything; the device re-syncs), but a native shell's
SQLite is durable — the one *architectural* reason a desktop wrapper can earn its place, beyond
feel.

## The one fact that constrains native options: the editor

The block editor is built on ProseMirror/TipTap/BlockNote — **DOM-based; it does not run natively**
in React Native or Flutter (TipTap's maintainers: ProseMirror "won't support React Native anytime
soon"). So on any native shell the editor either runs in a **WebView** or gets **rewritten**.

The honest universal caveat: rich-text block editing on mobile is *hard in every framework* —
keyboards, IME, selection, scroll. Even Notion's mobile app leans on web views. Native frameworks
win at navigation, lists, and gestures — **not** the editor. So "smooth mobile" is largely an
editor-engineering problem regardless of shell.

## The options, if/when a shell is earned

| Approach | Editor | Extra codebase | When it makes sense |
| --- | --- | --- | --- |
| **PWA (default)** | The web editor, as-is | None | Now. Re-evaluate only on real pain |
| **Tauri 2 desktop wrapper** | System WebView | Minimal (config, not code) | "Real app" feel, tray icon, global shortcuts — plus **durable native SQLite** for the replica. Tiny bundles (~3–10 MB) |
| **Capacitor mobile wrap** | System WebView | Minimal | If the PWA feels fine but app-store presence / push notifications / durable storage matter |
| **React Native + Expo** | **WebView editor** (e.g. TenTap = TipTap-in-WebView) | **Yes — a second UI shell** | If mobile *navigation/lists/calendar* feel is the pain point. Native shell around the web editor; TS logic ports; **PowerSync ships an RN SDK** |
| **Flutter** | **Full rewrite** (no BlockNote, no shared TS) | Near-total rewrite | **Not recommended** — discards the editor and the shared TypeScript core, for a solo-ish builder invested in React |

The sync engine keeps shells cheap: the local database and sync layer are the *same* PowerSync
client on every platform (it swaps wasm-SQLite for native SQLite under a shell). A shell is chrome
plus a storage upgrade — never a second data architecture.

## Recommendation

1. **Ship the responsive PWA and live in it** on your laptop and phone through Phases 1–3. Treat it
   as the null hypothesis: no shell until the PWA demonstrably fails a real workflow.
2. **Desktop:** if a wrapper is ever earned, **Tauri 2** — near-zero code, native installers
   (AppImage/`.deb` for Linux first, then Windows). It's polish, not architecture.
3. **Mobile:** if the phone experience needs more than the PWA offers, test cheapest-first —
   Capacitor wrap, then **React Native + Expo with a WebView editor (TenTap)** if native
   navigation/gesture feel is what's missing.
4. **Never Flutter** for this product — it throws away the two biggest assets (the web editor and
   the TypeScript client core).

> Net: the platform decision is deliberately boring now. The PWA answers "every device" on day one;
> shells are earned, one at a time, by concrete pain — the same clutter test, applied to platforms.

## Sources

- [Tauri 2.0 stable release](https://v2.tauri.app/blog/tauri-20/) · [Tauri vs Electron 2026](https://www.gethopp.app/blog/tauri-vs-electron)
- [TipTap won't support React Native natively — use a WebView (maintainer discussion)](https://github.com/ueberdosis/tiptap/discussions/3113) · [Expo: editing rich text via WebView](https://docs.expo.dev/guides/editing-richtext/) · [TenTap — TipTap-in-WebView for React Native](https://github.com/10play/10tap-editor)
