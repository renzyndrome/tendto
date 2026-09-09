/**
 * Which shell the app is running in.
 *
 * `VITE_PLATFORM` is set to "desktop" by the repo-root `.env.desktop`, which Vite loads only for
 * `--mode desktop` (the Tauri build). Because Vite inlines `import.meta.env`, this is a literal
 * `false` in the browser build — so every `if (isDesktop)` branch, and every dynamic import
 * inside one, is dropped by the bundler. The browser bundle never carries Tauri code.
 *
 * Use this, not a runtime `window.__TAURI__` check: a runtime check cannot be constant-folded,
 * so the Tauri packages would be pulled into the web bundle we ship to phones.
 */
export const isDesktop = import.meta.env.VITE_PLATFORM === "desktop";
