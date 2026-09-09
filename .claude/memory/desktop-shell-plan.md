---
name: desktop-shell-plan
description: Researched plan for the Tauri 2 (Rust) desktop shell — PowerSync Tauri plugin is the required path, not webview storage
metadata:
  type: project
---

Researched 2026-07-13 (user asked to bring Rust in for a desktop app). Key facts that shape the
build, from PowerSync/Tauri primary sources:

- **Do NOT run `@powersync/web` inside a Tauri webview.** PowerSync's own guidance (Mar 2026):
  IndexedDB/OPFS in Tauri's webview don't reliably persist across app updates — the replica can
  reset on a new build, losing unsynced writes. So a "just wrap the PWA" desktop app is
  demo-grade only.
- **First-party `tauri-plugin-powersync` exists (ALPHA, Mar 2026)** — crates.io
  `tauri-plugin-powersync` + npm `@powersync/tauri-plugin`. Rust backend owns a NATIVE SQLite
  file with the Rust `powersync-sqlite-core` statically linked; JS mirrors the Web SDK API over
  IPC (frontend nearly unchanged). This is where Rust enters TendTo: replica + sync move out of
  the webview into Rust. Alpha caveats: the backend **connector must be implemented in Rust**
  (JS can't initiate connect()); prefers Sync Streams (GA May 2026) over legacy sync rules for
  full status APIs. There's also a `powersync` Rust crate (alpha) underneath.
- **Tauri 2.11.x stable**; official plugins cover tray (core feature), notifications,
  global-shortcut, autostart, single-instance, deep-link, updater. Rust ≥1.77.2.
- **Linux is the risk**: WebKitGTK has 2025-26 reports of contenteditable misbehavior and
  rendering glitches — directly relevant to BlockNote/ProseMirror. Test the editor on WebKitGTK
  FIRST; keep the PWA as the Linux fallback; Electron + `@powersync/node` (beta) is plan B.
- **Honest perf framing**: Rust doesn't speed up the editor/UI (DOM-bound, already
  local-instant). It buys durable native SQLite (vs evictable OPFS), faster large-workspace
  queries/initial sync, background sync from the tray, native notifications (Pomodoro), and a
  small footprint.

Build shape when started: `apps/desktop` (Tauri 2) loading the existing Vite bundle (the static
bundle was chosen for exactly this). Phase A: shell + tray/notifications + WebKitGTK editor
spike. Phase B: `tauri-plugin-powersync` + Rust connector (fetchCredentials → better-auth token;
uploadData → FastAPI /sync/upload). Pin alpha versions; expect churn.

## Built 2026-09-09 (Phase 4) — what the research got right, and what it missed

Both phases landed in one pass: `apps/desktop` (Tauri 2.11) with the alpha plugin and a Rust
connector. The research above held up; three things it did not say:

- **Version alignment is a hard gate.** `@powersync/tauri-plugin` 0.0.6 pins `@powersync/common`
  2.0.0 and `shared-internals` 1.1.0 EXACTLY, which forces `@powersync/web` 2.1.0 +
  `@powersync/react` 2.0.0 and nothing newer. See [[powersync-version-alignment]].
- **Auth was the real work, not the sync.** The `tauri://localhost` origin breaks both CORS and
  the session cookie; see [[desktop-auth]].
- **FTS5 works natively.** rusqlite's bundled SQLite has it, so search is not stuck on the LIKE
  fallback — confirmed by the `fts_*` tables existing in the shell's own database file.

**The WebKitGTK editor spike PASSED (2026-09-09, Renzy at the keyboard).** This was the one risk
doc 04 named for Linux, and the reason a "wrap the PWA" shell was never going to be enough. The
editor behaves in WebKitGTK, so the Tauri shell is the Linux answer and Electron + `@powersync/node`
stays unused as plan B. Everything else was verified from automation: upload 200s, `ps_crud`
drained, a page created elsewhere appearing live in the sidebar, FTS5 built natively.

**Toolchain traps (2026-09-09, hit for real):**

- **`libclang-dev` is required and is NOT in Tauri's prerequisite list.** `powersync_sqlite_nostd`
  runs bindgen, which needs clang's builtin headers; without it the build fails with
  `'stdarg.h' file not found` from a crate nobody mentioned. `scripts/desktop-deps.sh` now checks
  for it.
- **`make` sees neither rustup nor nvm.** Its non-login shell has no `~/.cargo/bin` and no nvm
  node, so a perfectly good toolchain reports as missing and Tauri fails at `npm: not found`
  deep in the frontend build. The Makefile now resolves both onto PATH itself (nvm via
  `~/.nvm/alias/default`), and only adds node when npm is not already there.

