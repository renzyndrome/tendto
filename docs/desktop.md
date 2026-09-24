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
local-instant. What Rust buys is durability, background sync from the tray, native reminders, and
one thing a browser cannot do at all: running your own AI subscription (see below).

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
| Running your own AI CLI | `src-tauri/src/ai.rs` |
| JS side of the sync seam | `apps/web/src/lib/powersync/platform.desktop.ts` |
| JS side of the AI seam | `apps/web/src/lib/ai/engine.desktop.ts` |

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

- `cargo clippy -D warnings` clean; 15 Rust unit tests cover the upload payload contract (the exact
  JSON `POST /sync/upload` expects), JWT expiry parsing, the session file's 0600 permissions, and
  the AI CLI's stream parsing, prompt assembly and binary detection (against a planted fake).
- The shell launches, renders the app, and restores its session from the Rust-side token.
- The **whole sync loop**: local writes drained from `ps_crud` via `POST /sync/upload` (200), rows
  landing in Postgres, and a page created elsewhere appearing in the shell's own SQLite file and
  live in the sidebar.
- **FTS5 works natively** — the `fts_pages`/`fts_items`/`fts_blocks` indexes build against
  rusqlite's bundled SQLite, so search is not stuck on the LIKE fallback.

- **The editor works on WebKitGTK** (checked by hand, 2026-09-09). This was the one risk that
  could have sunk the shell on Linux. If rendering ever glitches on another machine, try
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` before concluding anything.

**Not yet verified:** tray menu, close-to-tray, second-launch focus, a native notification firing
from a Pomodoro, and the live AI path end to end (see the manual probe below).

## Connect your own AI subscription

The desktop shell can run AI on **your** machine, using the `claude` or `codex` CLI you already
have installed and signed in. Nothing is sent to the server, the operator pays nothing, and it
works with no API key.

Sidebar → **AI engine**. The list shows every CLI found on this machine, then the TendTo server
(only when the server has an engine of its own), then Off. With nothing chosen, a **verified** CLI
that is present wins: it is your own subscription, and it is the only option where your text does
not leave the machine. The setting is per device. Off means off, including the evening recap.

`claude` is verified. `codex` is detected and offered but **never chosen by default**, and you
have to pick it on purpose. See the containment note below for why that distinction matters.

### Containment

The engines read your pages, and in a shared workspace a page can be something a colleague wrote.
The system prompt tells the model to treat that text as data and never as instructions, but that
is a request to a model, not a boundary. The boundary is the flags:

| | Boundary |
| --- | --- |
| `claude` | `--max-turns 1`: no tool-use round trip is possible at all |
| `codex` | `--sandbox read-only`: no file writes, no network |

Both also run in an empty scratch directory, with the prompt over stdin rather than argv, under a
120-second timeout. `codex exec` is read-only by default already, so the flag is belt and braces:
if it were ever wrong, codex would exit with an error rather than run unconstrained.

`codex` is marked unverified because nobody has run it here. Its argv and that sandbox flag are
taken from its documentation, not from a test.

### Why the binary is spawned rather than an SDK embedded

This is a billing decision, not a style one. Usage through the installed CLI draws on your
subscription. Going through the agent SDK draws on a **separate, pricier credit pool**, which
would defeat the entire point of using a plan you already pay for.

### The trap: PATH

An app launched from a dock icon or a `.desktop` entry inherits a **bare** environment. None of
the shell profile that put `claude` on your PATH has run, so a CLI installed under nvm is simply
invisible. `claude` there is also a node script, so it needs `node` on PATH too.

`ai.rs` handles this by asking a login shell (`$SHELL -l -c 'command -v claude'`) when the
inherited PATH comes up empty, and caches the absolute path. **Test it by launching the installed
app from its icon, not from a terminal.** Starting it from a terminal proves nothing: that
process inherits your interactive PATH and will find the CLI either way.

If the AI row says "No CLI found", it also says what it looked for.

### What runs where

| | Facts | Prose |
| --- | --- | --- |
| Recap, server engine | server | server |
| Recap, local engine | server | this machine |
| Recap, AI off | server | nothing written |
| Summarize / Ask my notes, local engine | n/a | this machine |

The recap is **split**, not moved. Gathering activity reads Postgres behind a membership check
and has to stay on the server, which is also what makes the recap work on a phone. Only the prose
moves. When a local engine is active the client sends `prose: false`, and the server returns the
same `digest` it would have fed a model.

The **prompts always come from the server** (`GET /ai/status` ships each task's `system`). They
carry the prompt-injection rule, and that matters more here, not less: the engine is an agentic
CLI on your own machine and the text can be something a colleague wrote in a shared workspace.
They are cached on the device so local AI still works with no network.

### Manual probe

Nothing automated can cover this path, so check it by hand after any change to `ai.rs` or
`engine.desktop.ts`:

1. `make desktop` on a machine with `claude` installed.
2. Sidebar → AI engine shows "Claude CLI found" and the absolute path.
3. Open a page with a few paragraphs and press Summarize. The text streams in.
4. Nothing appears in the API log: no `/ai/compose/stream` request.
5. Set the engine to Off. The AI buttons disappear, and `/recap` shows the facts with no prose
   and no "point the server at an AI engine" hint.
6. Rename the CLI temporarily so it cannot be found, then open `/recap`. It should say
   "Local engine failed", not the server's .env advice.
7. **Install the build and launch it from the icon**, then repeat step 2. This is the PATH test.

## Releasing

Installers are built by GitHub Actions and attached to a **draft** release, triggered by a
version tag.

**Before the first release**, set three repository variables (Settings → Secrets and variables →
Actions → **Variables**, not Secrets — they are public URLs): `VITE_API_URL`, `VITE_AUTH_URL` and
`VITE_POWERSYNC_URL`, pointing at the deployed backend from `docs/deploy-dokploy.md`.

They are not optional. Those URLs are **compiled into the bundle**, so a build without them
produces an app that starts, signs nobody in, and looks like it is merely offline. The Vite config
refuses to build a desktop release rather than ship that.

```bash
./scripts/bump-version.sh 0.2.0     # writes the version into all five files
git add -A && git commit -m "chore: release v0.2.0"
git tag v0.2.0 && git push origin main --tags
```

Then, before publishing the draft:

1. Install the `.AppImage` on a machine that is **not** your dev box — the point is to catch a
   build that only works next to `make dev`.
2. Sign in, write a page, and confirm it reaches the server.
3. Walk the four behaviours nothing has ever tested: the tray menu, closing to the tray,
   launching a second time (the running window should come forward), and a Pomodoro firing a
   native notification.
4. Attach a line about anything you found, then publish.

The release is a draft and marked pre-release on purpose: **Linux is the only tested platform.**
Windows and macOS are built because the code compiles for them. Nothing is signed, so SmartScreen
and Gatekeeper will both warn on first run.

A new backend address means a new binary for everyone, because there is no auto-updater and no
runtime configuration.

## Deliberately not built

Auto-updater, code signing/notarization, autostart, deep links, and a tightened CSP. Each is a
decision to take on its own, not a default.

Windows and macOS bundles are now *produced* by the release workflow, which is not the same as
supported: nobody has run them.
