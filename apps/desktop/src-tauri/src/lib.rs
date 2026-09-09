//! TendTo desktop shell.
//!
//! The window renders the very same React bundle the browser does — the shell is packaging, not a
//! second frontend. What Rust adds is the part a browser cannot give us:
//!
//!   - **A durable replica.** `tauri-plugin-powersync` keeps the SQLite file on the filesystem
//!     instead of in the webview's OPFS, which browsers may evict and which Tauri does not
//!     reliably carry across app updates. That is the one architectural reason this shell exists.
//!   - **A session that survives updates**, stored by Rust rather than in webview storage
//!     (`session.rs`), which is also what lets the sync connector authenticate on its own.
//!   - **Tray + native notifications**, so reminders arrive while the window is closed.
//!
//! The PowerSync Tauri SDK is alpha and its JS↔Rust protocol is explicitly unstable, so both
//! crates are pinned exactly and must move together with the JS packages in apps/web — see
//! .claude/memory/powersync-version-alignment.md.

mod commands;
mod connector;
mod session;
mod tray;

use std::sync::Arc;

use tauri::Manager;

use crate::commands::SyncState;
use crate::session::SessionStore;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Single-instance must be registered FIRST: it has to intercept a second launch before
        // any other plugin sets up state. Launching again raises the running window, which is
        // also what a user clicking the tray icon expects.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::show_main(app);
        }))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_powersync::init())
        .manage(SyncState::default())
        .setup(|app| {
            // Both live under the app's own data directory, so a second account on the same
            // machine never shares them.
            let data_dir = app.path().app_data_dir()?;
            app.manage(Arc::new(SessionStore::open(&data_dir)?));
            tray::build(app.handle())?;
            Ok(())
        })
        .on_window_event(tray::on_window_event)
        .invoke_handler(tauri::generate_handler![
            commands::connect,
            commands::reconnect,
            commands::session_set,
            commands::session_clear,
            commands::session_get,
        ])
        .run(tauri::generate_context!())
        .expect("error while running TendTo");
}
