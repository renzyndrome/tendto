# TendTo desktop (Tauri 2) — build, spike, and the Phase B PowerSync path

`apps/desktop/` is a **Tauri 2** shell (a Rust binary + the OS webview) that loads the *same*
`apps/web` bundle. It exists for what a PWA can't give: **durable native SQLite** (vs evictable
OPFS), a **tray**, **native OS notifications**, and background sync. Rust enters TendTo here.

> **Authoring note.** The Rust/Tauri code here was written in an environment **without** the Rust
> toolchain or the WebKitGTK dev libs, so it is **not compile-verified**. Phase A is standard,
> documented Tauri 2.11 and should build directly; Phase B is against an **alpha** SDK and every
> uncertain line is tagged `TODO(verify-on-machine)`. The only part verified here is the
> browser-safe notification bridge in `apps/web` (it must never regress the web build).

## Two phases
- **Phase A (shipped scaffold, stable):** the shell + tray + single-instance + window-state +
  native notifications wired to the focus timer. The webview still uses today's `@powersync/web`
  (wasm SQLite / OPFS). This is the **spike**: prove the BlockNote editor is usable on each
  platform's webview — especially Linux/WebKitGTK — *before* investing in Phase B.
- **Phase B (documented below, alpha):** replace the web replica with **native SQLite owned by
  Rust** via `tauri-plugin-powersync`. Only pursue this once the Phase A spike passes.

---

## Run it (Phase A)

### 1. Linux system deps (Debian/Ubuntu)
```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
```
`4.1` (not `4.0`) is required for Tauri 2; `libayatana-appindicator3-dev` backs the tray. Only if a
build error demands it: `sudo apt install patchelf libgtk-3-dev libsoup-3.0-dev`.
(macOS: Xcode CLT. Windows: WebView2 + MSVC build tools. — see v2.tauri.app/start/prerequisites.)

### 2. Rust toolchain
```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh   # default stable
```

### 3. Install (icons are already committed)
```bash
cd apps/desktop
npm install                              # @tauri-apps/cli + api
```
Placeholder icons ship in `src-tauri/icons/` (a dark rounded square with a "T"), so the app runs
with **no logo needed**. When you have a real logo, replace them in place:
```bash
npx tauri icon path/to/your-logo.png     # square PNG, ideally 1024×1024
```

### 4. Dev / build
```bash
# Boot the backend first (from repo root): make db && make auth && make api
# Ensure apps/web/.env has VITE_API_URL / VITE_AUTH_URL / VITE_POWERSYNC_URL (the CSP pre-authorizes them).

cd apps/desktop && npm run dev     # Tauri launches Vite (:15173) and opens the native window
cd apps/desktop && npm run build   # builds apps/web/dist and bundles a native installer
```

---

## The WebKitGTK editor spike — the acceptance gate (Linux)

This is the **make-or-break** test: whether BlockNote/ProseMirror is usable in WebKitGTK. Run
`npm run dev`, open a page with the editor, and verify:

- [ ] **Immediately editable — no right-click-to-focus.** Ubuntu 24.04+ WebKitGTK has a regression
      where `contenteditable` isn't editable until right-clicked (repros in ProseMirror/TipTap).
      This is the #1 thing to reproduce or refute on your target image
      (tauri-apps/tauri#9088). **If this reproduces and can't be worked around, Tauri-on-Linux is
      not viable for the editor — keep the PWA as the Linux answer, or use Electron.**
- [ ] **No blank/white window or resize crash** on your GPU (esp. NVIDIA) without env overrides.
      Console symptom: `AcceleratedSurfaceDMABuf was unable to construct a complete framebuffer`.
- [ ] **Caret renders correctly** around inline non-editable nodes (BlockNote decorations).
- [ ] **Typing + scroll latency acceptable** on a large page.

**DMABUF workarounds — tiered, apply only if the above fails** (each degrades perf on healthy setups;
do not ship unconditionally):
1. `__NV_DISABLE_EXPLICIT_SYNC=1` (Wayland/NVIDIA crashes; no perf cost)
2. `WEBKIT_DISABLE_DMABUF_RENDERER=1` (DMABUF framebuffer errors; loses the fast path)
3. `WEBKIT_DISABLE_COMPOSITING_MODE=1` (last resort)

If one is required, gate it in `run()` before webview creation and measure the cost:
```rust
#[cfg(target_os = "linux")]
{
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1"); // spike-gated; measure typing/scroll cost
}
```
macOS (WKWebView) and Windows (WebView2/Chromium) should be fine — the PWA already runs in Safari.

---

## Phase B — native SQLite via `tauri-plugin-powersync` (ALPHA)

**Do this only after the Phase A spike passes.** The plugin's Rust connector API, the JS↔Rust IPC
bridge, `PowerSyncError` construction, and the capability identifier are **alpha ("expect breaking
changes")**. Pin exact versions, commit lockfiles, and keep desktop sync gated so alpha churn can't
destabilize the shipping web build. Docs: docs.powersync.com/client-sdks/reference/tauri and
powersync-js discussion #873.

### B1. Version pins (exact, not caret)
| Piece | Name | Pin |
| --- | --- | --- |
| JS plugin | `@powersync/tauri-plugin` | `0.0.4` |
| Rust plugin | `tauri-plugin-powersync` | `=0.0.4` |
| Rust SDK | `powersync` | `=0.0.5` |
| JS peer | `@powersync/common` | must match `apps/web`'s existing `@powersync/web@1.38.7` chain — **do not** end up with two `common` copies. `TODO(verify-on-machine)` |

### B2. `src-tauri/Cargo.toml` — append to the Phase A deps
```toml
tauri-plugin-powersync = "=0.0.4"
powersync = "=0.0.5"
async-trait = "0.1"
reqwest = { version = "0.13", features = ["json"] }
tokio = { version = "1.50", features = ["sync"] }
```
And add `"powersync:default"` to `capabilities/default.json` permissions (`TODO(verify-on-machine)`:
exact identifier from the plugin's generated `permissions/`).

### B3. `src-tauri/src/lib.rs` — connector + `connect` command (register `tauri_plugin_powersync::init()` in `run()`)
```rust
use async_trait::async_trait;
use powersync::error::PowerSyncError;
use powersync::{BackendConnector, PowerSyncCredentials, PowerSyncDatabase, SyncOptions, UpdateType};
use tauri::{AppHandle, Runtime};
use tauri_plugin_powersync::PowerSyncExt; // brings `.powersync()` onto AppHandle
use tokio::sync::Mutex;

struct AppBackendConnector {
    db: PowerSyncDatabase,
    powersync_url: String, // VITE_POWERSYNC_URL (:18080)
    api_base: String,      // VITE_API_URL (:18000)
    http: reqwest::Client,
    token: Mutex<String>,  // JWT handed in from JS; see B5 for the refresh problem
}

#[async_trait]
impl BackendConnector for AppBackendConnector {
    async fn fetch_credentials(&self) -> Result<PowerSyncCredentials, PowerSyncError> {
        // PowerSyncCredentials is documented to have ONLY { endpoint, token } — no expiry.
        let token = self.token.lock().await.clone();
        Ok(PowerSyncCredentials { endpoint: self.powersync_url.clone(), token })
        // TODO(verify-on-machine): a static token stops syncing on expiry — see B5.
    }

    async fn upload_data(&self) -> Result<(), PowerSyncError> {
        // One transaction per call (mirrors apps/web's getNextCrudTransaction() — do NOT loop-all-
        // and-complete-only-last; that discards earlier txs on failure).
        let Some(tx) = self.db.next_crud_transaction().await? else { return Ok(()) };
        let entries: Vec<serde_json::Value> = tx.crud.iter().map(|op| {
            let opstr = match op.update_type {
                UpdateType::Put => "PUT", UpdateType::Patch => "PATCH", UpdateType::Delete => "DELETE",
            };
            serde_json::json!({ "op": opstr, "table": op.table, "id": op.id, "data": op.data })
        }).collect();

        let token = self.token.lock().await.clone();
        let resp = self.http
            .post(format!("{}/sync/upload", self.api_base))
            .bearer_auth(token)
            .json(&serde_json::json!({ "entries": entries }))
            .send().await
            .map_err(|e| PowerSyncError::from(e))?; // TODO(verify-on-machine): real PowerSyncError ctor
        if !resp.status().is_success() {
            // Leave the tx queued so PowerSync retries with backoff.
            return Err(PowerSyncError::from(std::io::Error::other(
                format!("upload failed: {}", resp.status()))));  // TODO(verify-on-machine): ctor
        }
        tx.complete().await?; // clears the queue for THIS tx only
        Ok(())
    }
}

#[tauri::command]
async fn connect<R: Runtime>(
    app: AppHandle<R>, handle: usize, powersync_url: String, api_base: String, token: String,
) -> tauri_plugin_powersync::Result<()> {
    let database = app.powersync().database_from_javascript_handle(handle)?; // TODO(verify): IPC name churns
    let connector = AppBackendConnector {
        db: database.clone(), powersync_url, api_base,
        http: reqwest::Client::new(), token: Mutex::new(token),
    };
    database.connect(SyncOptions::new(connector)).await; // TODO(verify): SyncOptions shape
    Ok(())
}
```
**Verified (docs.rs powersync 0.0.5):** `BackendConnector::fetch_credentials/upload_data`;
`PowerSyncCredentials { endpoint, token }` (no expiry); `CrudEntry { update_type, table, id, data }`;
`UpdateType { Put, Patch, Delete }`; `CrudTransaction::complete()`; `next_crud_transaction()`;
`connect(SyncOptions)`; **connect is Rust-only — JS `db.connect()` throws.**
**Undocumented (all tagged above):** `PowerSyncError` constructors/`From`, `PowerSyncExt::powersync()`,
`database_from_javascript_handle`, `SyncOptions::new`.

### B4. `apps/web` — the runtime Tauri branch (the real integration edit)
`apps/web/src/lib/powersync/client.ts` hard-imports `@powersync/web`. Since desktop ships the same
bundle, split it into a factory that **dynamic-imports** the platform SDK (so neither build eagerly
loads the other's SDK). New `apps/web/src/lib/powersync/db.ts`:
```ts
import { isTauri } from "../desktop/notify";
import { AppSchema } from "./schema";       // reused verbatim on both platforms
import { getAuthToken } from "../auth/token";

export let db: import("@powersync/common").AbstractPowerSyncDatabase;

export async function initDb() {
  if (isTauri()) {
    const { PowerSyncTauriDatabase } = await import("@powersync/tauri-plugin");
    const { appDataDir } = await import("@tauri-apps/api/path");
    const { invoke } = await import("@tauri-apps/api/core");
    const tdb = new PowerSyncTauriDatabase({
      schema: AppSchema,
      database: { dbFilename: "tendto.db", dbLocationAsync: appDataDir }, // TODO(verify): option keys
    });
    await tdb.init();
    const token = await getAuthToken();
    await invoke<void>("connect", {
      handle: (tdb as any).rustHandle,      // TODO(verify): rustHandle field name
      powersyncUrl: import.meta.env.VITE_POWERSYNC_URL,
      apiBase: import.meta.env.VITE_API_URL,
      token,
    });
    db = tdb as unknown as typeof db;
    return;
  }
  const { PowerSyncDatabase } = await import("@powersync/web");
  const wdb = new PowerSyncDatabase({ schema: AppSchema, database: { dbFilename: "tendto.db" } });
  db = wdb;
  const { Connector } = await import("./web-connector"); // today's Connector class, moved out of client.ts
  await wdb.connect(new Connector());
}
```
Move today's `Connector` into `apps/web/src/lib/powersync/web-connector.ts` unchanged; replace the
`connectDb()` bootstrap with `await initDb()`. Reactive reads/writes (`@powersync/react` hooks,
`getAll`/`execute`/`writeTransaction`) work unchanged on both platforms. **Do this behind the
`isTauri()` dynamic-import guard so the web build never loads the alpha plugin.**

### B5. Auth token — the genuinely unsolved problem (no sanctioned pattern)
better-auth's `GET :13001/api/auth/token` is **session-cookie** authenticated; the cookie is in the
webview, but `fetch_credentials` runs in **Rust**, and `PowerSyncCredentials` has **no expiry field**,
so the SDK refreshes by re-calling `fetch_credentials` — returning the *stale* static token above.
Options (none doc-covered):
1. **Forward the session cookie to Rust** (closest to today's flow): pass the cookie to `connect`,
   have `fetch_credentials` call `:13001/api/auth/token` with a `Cookie` header via `reqwest`,
   re-fetch on 401. **Recommended starting point** (fragile: HttpOnly/rotation).
2. **Rust owns the whole better-auth session** (sign-in + cookie store in Rust). Cleanest for
   headless background sync; larger design change (auth leaves the webview).
3. **JS-push refresh:** add a `#[tauri::command] refresh_token` that replaces the connector's
   `Mutex<String>` token; Rust emits an event when it needs one, JS calls `getAuthToken()` + invokes
   it. Works only while a window is alive. Keep as a stopgap alongside (1).

### B6. Alpha limitations that hit TendTo
- `connect()` is Rust-only (handled above).
- Partial sync status: `lastSyncedAt` / `hasSynced` / `priorityStatusEntries` are **unavailable**;
  use `SyncStatus.forStream` / `status.connected`. Any desktop "synced" indicator must be
  stream-status based.
- **Sync Streams-oriented.** TendTo's `infra/powersync/sync-rules.yaml` is **legacy bucket rules** —
  **highest integration risk**: whether it works unmodified or must be ported to Sync Streams for
  the desktop client. **Test against `make db`'s PowerSync service FIRST, before building UI.**
  `TODO(verify-on-machine)`.
- The JS↔Rust IPC protocol is explicitly unstable.

---

## In-repo contract files the Phase B connector/JS branch must match
`apps/web/src/lib/powersync/{client.ts,schema.ts}` · `apps/web/src/lib/auth/token.ts` ·
`apps/api/app/routers/sync.py` · `apps/api/app/schemas/sync.py` · `apps/web/src/stores/focus.ts` ·
`apps/web/src/components/focus/focus-view.tsx`.
