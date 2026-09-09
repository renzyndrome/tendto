/**
 * The better-auth SESSION token, for the desktop shell only.
 *
 * Why this exists: in the browser the session lives in an HttpOnly cookie and nothing in the app
 * ever handles it. The desktop shell cannot use that cookie at all — its webview runs on a
 * `tauri://localhost` origin, and a SameSite=Lax cookie is never sent cross-site to the auth
 * service. So on desktop the client authenticates with `Authorization: Bearer <session token>`
 * (better-auth's `bearer()` plugin), and the token has to be held somewhere.
 *
 * It is kept in memory here, and — from Phase B — persisted by Rust in a 0600 file under the
 * app's data directory, NOT in localStorage: the webview's storage is the thing Tauri is known
 * to reset across app updates, and a session that silently disappears on every update is worse
 * than one the user has to think about. `setSessionToken` is what bridges the two.
 *
 * In the browser build every function here is inert: `isDesktop` is a compile-time false, so
 * `getSessionToken()` folds to "" and better-auth keeps using cookies.
 */
import { isDesktop } from "../platform";

let sessionToken = "";

/** The bearer token for the desktop client, or "" in the browser / when signed out. */
export function getSessionToken(): string {
  return isDesktop ? sessionToken : "";
}

/** Remember a session token captured from the `set-auth-token` response header. */
export function setSessionToken(token: string): void {
  if (!isDesktop) return;
  sessionToken = token;
}

/** Forget the session token. Called on sign-out, before the replica is cleared. */
export function clearSessionToken(): void {
  sessionToken = "";
}
