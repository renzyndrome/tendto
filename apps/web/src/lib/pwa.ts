/**
 * Service-worker registration for the installable PWA.
 *
 * vite-plugin-pwa can inject its own registration script, but we do it here (`injectRegister:
 * null` in vite.config.ts) for one reason: an installed PWA on a phone is a long-lived process
 * that may not be "reloaded" for weeks. `registerType: "autoUpdate"` only picks up a new build
 * when the browser re-checks the service worker, so we ask for that check on a timer. Without
 * it, a phone can sit on a stale build indefinitely.
 *
 * There is deliberately no "an update is available" prompt: autoUpdate installs the new build
 * and the next launch has it. A toast asking the user to reload is exactly the clutter this
 * product refuses.
 *
 * In the desktop (Tauri) build the plugin is disabled, and `virtual:pwa-register` resolves to a
 * no-op stub — so this module is safe to call unconditionally.
 */
import { registerSW } from "virtual:pwa-register";

/** How often an open app asks the browser to look for a new build. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

export function installServiceWorker(): void {
  registerSW({
    immediate: true,
    onRegisteredSW(_swUrl, registration) {
      if (!registration) return;
      setInterval(() => void registration.update(), UPDATE_CHECK_MS);
    },
    onRegisterError(error) {
      // Non-fatal: the app runs fine without a service worker, it just loses offline cold boot.
      console.error("Service worker registration failed", error);
    },
  });
}
