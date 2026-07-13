//! TendTo desktop — Phase A shell: loads the web bundle, adds a tray icon, single-instance,
//! window-state restore, and a native-notification command the focus timer calls when a Pomodoro
//! interval ends. Phase B (native PowerSync in Rust) is documented in docs/desktop.md.
//!
//! NOTE: this crate is compile-verified on a machine with the WebKitGTK dev libs + Rust toolchain
//! (see docs/desktop.md); it was authored in an environment without them.

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};
use tauri_plugin_notification::NotificationExt;

/// Fired from the webview when a Pomodoro phase ends. `phase` is the phase that JUST ENDED
/// ("work" | "break"), matching apps/web/src/stores/focus.ts `FocusPhase`.
#[tauri::command]
fn notify_interval_ended(app: tauri::AppHandle, phase: String) -> Result<(), String> {
    let body = match phase.as_str() {
        "work" => "Focus interval complete — take a break.",
        "break" => "Break over — back to it.",
        _ => "Timer complete.",
    };
    app.notification()
        .builder()
        .title("TendTo")
        .body(body)
        .show()
        .map_err(|e| e.to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    // Single-instance MUST register first so a second launch focuses the existing window instead
    // of opening a duplicate (which would fight over the Phase B native SQLite file).
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            focus_main_window(app);
        }));
    }

    builder
        .plugin(tauri_plugin_notification::init())
        .invoke_handler(tauri::generate_handler![notify_interval_ended])
        .setup(|app| {
            #[cfg(desktop)]
            {
                app.handle()
                    .plugin(tauri_plugin_window_state::Builder::default().build())?;
                setup_tray(app.handle())?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(desktop)]
fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg(desktop)]
fn setup_tray(app: &tauri::AppHandle) -> tauri::Result<()> {
    let show_item = MenuItem::with_id(app, "show", "Show TendTo", true, None::<&str>)?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

    TrayIconBuilder::with_id("main-tray")
        // Reuses bundle.icon; run `tauri icon <logo.png>` first, or this unwrap panics.
        .icon(app.default_window_icon().unwrap().clone())
        .tooltip("TendTo")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main_window(app),
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}
