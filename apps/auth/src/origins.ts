/**
 * Browser origins this service trusts.
 *
 * There are two kinds of client, and they do not share an origin:
 *
 *   - the **web app**, served from `WEB_URL`;
 *   - the **desktop shell**, whose Tauri webview serves the same bundle from its own scheme —
 *     `tauri://localhost` on Linux/macOS, `http://tauri.localhost` on Windows.
 *
 * Both the CORS allowlist and better-auth's `trustedOrigins` were a single string before Phase 4,
 * which silently rejected every desktop request. They are lists now, and the desktop origins are
 * DEFAULTS rather than something an operator must remember: forgetting them produces a failure
 * that reads like a broken session, not like a configuration mistake.
 *
 * Set `WEB_ORIGINS` (comma-separated) to override. `WEB_URL` is always included — dropping it
 * would lock out the web app itself.
 */
export const WEB_URL = process.env.WEB_URL ?? "http://localhost:15173";

/** The desktop shell's webview origins. Mirrors DESKTOP_ORIGINS in apps/api/app/config.py. */
export const DESKTOP_ORIGINS = ["tauri://localhost", "http://tauri.localhost"];

export function webOrigins(): string[] {
  const named = (process.env.WEB_ORIGINS ?? "")
    .split(",")
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
  // The desktop origins are ALWAYS included, not just when WEB_ORIGINS is blank: an operator who
  // sets WEB_ORIGINS to add a staging domain would otherwise silently break the desktop shell,
  // which is exactly the failure this module exists to prevent.
  return [...new Set([WEB_URL, ...named, ...DESKTOP_ORIGINS])];
}

/** Whether a request came from the desktop shell's webview rather than a browser. */
export function isDesktopOrigin(origin: string | undefined | null): boolean {
  return !!origin && DESKTOP_ORIGINS.includes(origin);
}
