---
name: pwa-install
description: What the installable PWA actually needs (icons, our own SW registration, a separate E2E config) and why each piece exists
metadata:
  type: project
---

Phase 4.0 (2026-09-09) finished the PWA so it installs on Android. `vite-plugin-pwa` had been
generating a service worker since Phase 1, but the app was **not installable**: Chrome requires a
manifest with a >=192px icon plus a controlling service worker, and the repo contained **zero
image assets**. Non-obvious decisions:

- **Icons are generated once and committed**, not generated during `vite build`. Wiring
  `pwaAssets` into vite.config.ts would pull `sharp` (a native module) into every build,
  including the `node:22-alpine` Docker image in `apps/web/Dockerfile`. So `pwa-assets.config.ts`
  is CLI-only (`npm run pwa-assets`) and `public/*.png` is checked in. Source of truth for both
  the PWA icons and the future Tauri icons is `public/logo.svg`; all its ink sits inside the
  central 80% so an Android circular mask never clips the mark.
- **We register the service worker ourselves** (`src/lib/pwa.ts`, with `injectRegister: null`)
  rather than using the plugin's injected script. Reason: an installed PWA on a phone can run for
  weeks without a "reload". `registerType: "autoUpdate"` only picks up a build when the browser
  re-checks the worker, so `pwa.ts` asks for that check hourly. Without it a phone can sit on a
  stale build indefinitely. There is deliberately **no** "update available" toast — autoUpdate
  installs it and the next launch has it; a reload prompt is exactly the clutter the product
  refuses (see [[theming]] for the same instinct applied to chrome).
- **The PWA E2E is a separate Playwright config** (`playwright.pwa.config.ts`, specs in
  `apps/web/e2e-pwa/`). The main suite runs `npm run dev`, and **the service worker and manifest
  only exist after `vite build`** — so it structurally cannot cover this. The PWA config builds
  and serves with `vite preview` on :15174, never reuses an existing server (a stale `dist/`
  would silently test the previous manifest), and needs no backend: a fresh context has no
  session, so the app settles on the sign-in screen, which is the shell an offline cold boot must
  render. `make e2e` runs it after the main suite; `make e2e-pwa` runs it alone.
- The spec asserts the **SQLite wasm is precached**, not just the shell. Workbox's default 2 MiB
  limit would silently drop the ~2.5 MB wasm, and the app would install fine and then fail to open
  offline — the failure mode is invisible until you are on a plane.

`localhost` cannot be reached from a phone, so the actual install is only testable from the
Dokploy VPS over HTTPS. The checklist lives in `docs/deploy-dokploy.md`.
