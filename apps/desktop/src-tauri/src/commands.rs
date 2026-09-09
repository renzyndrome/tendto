//! The commands the webview may invoke.
//!
//! Deliberately small. The frontend is the same React app the browser runs; everything here
//! exists because the alpha PowerSync Tauri SDK cannot do it from JavaScript, or because a
//! credential is safer in Rust than in webview storage.

use std::sync::Arc;

use tauri::{AppHandle, Runtime, State};
use tauri_plugin_powersync::PowerSyncExt;
use tokio::sync::Mutex;

use crate::connector::{TendToConnector, Urls};
use crate::session::SessionStore;

/// Everything needed to re-open the sync stream after a disconnect.
#[derive(Default)]
pub struct SyncState {
    connected: Mutex<Option<Urls>>,
}

/// Open the sync stream.
///
/// The webview calls this after `db.init()` with `db.rustHandle`; the alpha SDK throws if
/// JavaScript calls `connect()` itself. URLs come from the JS bundle (its baked-in `VITE_*`
/// values), which keeps one source of truth for which backend a build talks to.
#[tauri::command]
pub async fn connect<R: Runtime>(
    app: AppHandle<R>,
    session: State<'_, Arc<SessionStore>>,
    sync: State<'_, SyncState>,
    handle: usize,
    urls: Urls,
) -> Result<(), String> {
    let database = app
        .powersync()
        .database_from_javascript_handle(handle)
        .map_err(|error| error.to_string())?;

    let connector = TendToConnector::new(database.clone(), session.inner().clone(), urls.clone());
    // Remembered so `reconnect` can rebuild an identical connector without another round trip
    // to JavaScript.
    *sync.connected.lock().await = Some(urls);
    database
        .connect(powersync::SyncOptions::new(connector))
        .await;
    Ok(())
}

/// Re-dial the sync stream.
///
/// The browser needs this because PowerSync's backoff can grow long while a laptop sleeps (see
/// `installReconnectNudges` in client.ts). It is exposed here for the same reason, and is a no-op
/// before the first `connect`.
#[tauri::command]
pub async fn reconnect<R: Runtime>(
    app: AppHandle<R>,
    session: State<'_, Arc<SessionStore>>,
    sync: State<'_, SyncState>,
    handle: usize,
) -> Result<(), String> {
    let Some(urls) = sync.connected.lock().await.clone() else {
        return Ok(());
    };
    let database = app
        .powersync()
        .database_from_javascript_handle(handle)
        .map_err(|error| error.to_string())?;

    database.disconnect().await;
    let connector = TendToConnector::new(database.clone(), session.inner().clone(), urls);
    database
        .connect(powersync::SyncOptions::new(connector))
        .await;
    Ok(())
}

/// Hand Rust the better-auth session token, after sign-in.
#[tauri::command]
pub fn session_set(session: State<'_, Arc<SessionStore>>, token: String) -> Result<(), String> {
    session.set(token).map_err(|error| error.to_string())
}

/// Forget the session token, on sign-out.
#[tauri::command]
pub fn session_clear(session: State<'_, Arc<SessionStore>>) -> Result<(), String> {
    session.clear().map_err(|error| error.to_string())
}

/// The stored session token, if the app was signed in when it last closed.
///
/// The webview asks for this at startup so better-auth has a credential before its first request
/// — otherwise every restart would look like a sign-out.
#[tauri::command]
pub fn session_get(session: State<'_, Arc<SessionStore>>) -> Option<String> {
    session.get()
}
