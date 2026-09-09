# The desktop shell (Tauri 2)

A native window around the same React bundle the browser runs. The shell is **packaging, not a
second frontend** — there is one app, one editor, one set of E2E tests.

## Why it exists

Only one reason is architectural: **the replica is durable**. In a browser the local SQLite lives
in OPFS, which the browser may evict under disk pressure; inside a Tauri webview it is worse —
PowerSync's own guidance is that IndexedDB/OPFS there do not reliably survive an app update, so a
"just wrap the PWA" desktop app can silently reset the database and lose unsynced writes.

So the shell does **not** wrap the PWA. `tauri-plugin-powersync` hands the database to Rust, which
owns a real SQLite file under the app's data directory. Everything else the shell adds — the tray,
native notifications, a session that survives updates — is comfort on top of that.

The honest framing: Rust does not make the editor faster. The editor is DOM-bound and already
local-instant. What Rust buys is durability, background sync from the tray, and native reminders.

## One-time setup

```bash
make desktop-deps      # prints exactly what is missing, installs nothing
```

It will ask for two things:

```bash
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev \
                 libayatana-appindicator3-dev librsvg2-dev pkg-config patchelf libclang-dev
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh      # Rust >= 1.77.2
```

`libclang-dev` is **not** in Tauri's own prerequisite list, and it is not optional here:
`powersync_sqlite_nostd` generates its SQLite bindings with bindgen, which needs clang's builtin
headers. Without it the build dies with `'stdarg.h' file not found` from a crate you never named.

If your terminal lives inside a snap-packaged editor (VS Code's snap, say), `make desktop` strips
the snap's GTK/GLib variables before launching. Without that the binary builds fine and then dies
instantly with `symbol lookup error: /snap/core20/.../libpthread.so.0` — the snap's libraries are
built against a different glibc. `scripts/desktop-dev.sh` is where that scrub lives.

You should not have to source anything afterwards. The Makefile puts `~/.cargo/bin` and nvm's
default node on PATH itself, because `make` runs a non-login shell that has neither — which
otherwise reports a working toolchain as missing and fails inside Tauri with `npm: not found`.

## Running it

```bash
make desktop           # boots the backend stack, then the shell against the Vite dev server
make desktop-build     # installers → apps/desktop/src-tauri/target/release/bundle/{deb,appimage}
make desktop-test      # cargo fmt --check + clippy -D warnings + cargo test
```

`make desktop` reuses `scripts/e2e-stack.sh`, so it is the same backend the E2E suite uses. For a
release build against your deployed backend, put the production URLs in a gitignored
`.env.desktop.local` at the repo root (see `.env.desktop`); the URLs are baked into the JS bundle,
and Rust reads them from there at connect time rather than having its own copy.

## Installing it on your own machine

```bash
make desktop-build
sudo apt install ./apps/desktop/src-tauri/target/release/bundle/deb/TendTo_0.1.0_amd64.deb
```

That gives you a normal application with a menu entry and an icon. Uninstall with
`sudo apt remove tendto-desktop`. The bundle directory also holds a `.AppImage`, a single
executable file you can copy anywhere and run with no install (`chmod +x` it first).

**Which backend it talks to is decided when you build it, not when you run it.** The `VITE_*` URLs
are compiled into the bundle. A plain `make desktop-build` bakes in the localhost dev ports, so the
installed app only works while `make dev` is running.

To point it at a deployed server, create a gitignored `.env.desktop.local` at the repo root and
build again:

```
VITE_API_URL=https://api.your-domain
VITE_AUTH_URL=https://auth.your-domain
VITE_POWERSYNC_URL=https://sync.your-domain
```

Reinstall the new `.deb` over the old one. There is no auto-updater, so shipping a new version
means building and installing again — see the last section.

## How it fits together

| Piece | Where |
| --- | --- |
| Window, tray, close-to-tray, single instance | `src-tauri/src/lib.rs`, `tray.rs` |
| Backend connector (JWT + upload) | `src-tauri/src/connector.rs` |
| Session token, 0600 on disk | `src-tauri/src/session.rs` |
| Commands the webview may call | `src-tauri/src/commands.rs` |
| JS side of the seam | `apps/web/src/lib/powersync/platform.desktop.ts` |

Two things are worth knowing before changing any of it:

- **JavaScript cannot open the sync stream.** The alpha SDK throws from `db.connect()`. JS calls
  `db.init()`, then hands `db.rustHandle` and the service URLs to the Rust `connect` command.
- **The desktop cannot use the session cookie.** Its webview origin is `tauri://localhost`, and a
  SameSite=Lax cookie is never sent cross-site, so it authenticates with better-auth's `bearer()`
  plugin instead. See `.claude/memory/desktop-auth.md` for why, and what not to do.

Both PowerSync crates and all four PowerSync JS packages are **pinned exactly** and must be moved
as a set — see `.claude/memory/powersync-version-alignment.md`.

## What is verified, and what is not

Verified on Linux (Ubuntu 25.04, WebKitGTK 2.50):

- `cargo clippy -D warnings` clean; 10 Rust unit tests cover the upload payload contract (the exact
  JSON `POST /sync/upload` expects), JWT expiry parsing, and the session file's 0600 permissions.
- The shell launches, renders the app, and restores its session from the Rust-side token.
- The **whole sync loop**: local writes drained from `ps_crud` via `POST /sync/upload` (200), rows
  landing in Postgres, and a page created elsewhere appearing in the shell's own SQLite file and
  live in the sidebar.
- **FTS5 works natively** — the `fts_pages`/`fts_items`/`fts_blocks` indexes build against
  rusqlite's bundled SQLite, so search is not stuck on the LIKE fallback.

- **The editor works on WebKitGTK** (checked by hand, 2026-09-09). This was the one risk that
  could have sunk the shell on Linux. If rendering ever glitches on another machine, try
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` before concluding anything.

**Not yet verified:** tray menu, close-to-tray, second-launch focus, and a native notification
firing from a Pomodoro.

## Deliberately not built

Auto-updater, code signing/notarization, autostart, deep links, a tightened CSP, and Windows/macOS
bundles. Each is a decision to take on its own, not a default.
