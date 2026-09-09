// The bundled app must not pop a console window on Windows in release builds.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tendto_desktop_lib::run()
}
