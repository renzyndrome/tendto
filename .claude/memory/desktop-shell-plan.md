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
