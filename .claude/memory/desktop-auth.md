---
name: desktop-auth
description: Why the desktop shell uses a bearer session token instead of the cookie, and why Rust holds it
metadata:
  type: project
---

Phase 4.2 (2026-09-09). The desktop shell cannot authenticate the way the browser does, and the
failure is silent enough to be worth writing down.

**The cookie cannot work.** The Tauri webview serves the app from `tauri://localhost`
(`http://tauri.localhost` on Windows), not from `WEB_URL`. better-auth's session cookie is
SameSite=Lax, so the browser never sends it cross-site to the auth service. Before the fix, a
sign-up from that origin came back **403** — the origin was not trusted either. Both problems are
real and separate:

1. **Origins became lists.** `apps/auth/src/origins.ts` (`webOrigins()`) feeds both the Hono CORS
   allowlist and better-auth's `trustedOrigins`; `Settings.cors_origins` in `apps/api/app/config.py`
   does the same for FastAPI. `WEB_URL` is always included, and the two Tauri origins are DEFAULTS
   rather than something an operator must remember — forgetting them produces a CORS failure that
   reads like a broken session. `WEB_ORIGINS` (comma-separated) overrides. Runtime config, so
   changing it is a restart, not a rebuild.
2. **The desktop authenticates with a bearer token.** better-auth's `bearer()` plugin is enabled
   server-side; sign-in returns the session token in a `set-auth-token` header. The web app is
   untouched and still uses cookies — the client branch is behind `isDesktop`, a build-time
   constant.

**The trap that nearly shipped: `bearer()` leaks the session token to EVERY origin.** Its response
hook is `matcher() { return true }` — it attaches the raw session token to any response that sets
the session cookie, whether or not a bearer was used, and sets its own
`Access-Control-Expose-Headers`. The first version of this change simply added
`exposeHeaders: ["set-auth-token"]` to the shared CORS config, which handed the browser app's own
page JavaScript a portable credential: HttpOnly stops mattering, and a contained XSS becomes
account takeover from any device. Verified by curl before the fix — the web origin really did
receive the token.

The fix is a middleware in `apps/auth/src/index.ts` that runs after the handler and, for any origin
that is not the shell's, **deletes both** `set-auth-token` and `Access-Control-Expose-Headers`;
the shell's origin gets the header set exactly once. `e2e/desktop-auth.spec.ts` pins both halves.
The general lesson: an auth plugin added for one client is on by default for all of them — check
what it does to the clients you did not have in mind.

**Rust holds the token, not localStorage.** `session.rs` writes it 0600 under the app data
directory. Webview storage is exactly what Tauri does not reliably preserve across app updates
(the same reason the replica moved to native SQLite — see [[desktop-shell-plan]]), and a session
that vanishes on every update is a bug the user cannot diagnose. It also has to be reachable from
Rust anyway: the sync connector mints its own 15-minute JWTs from it (mirroring
`apps/web/src/lib/auth/token.ts`), because `fetch_credentials` and `upload_data` run in Rust with
no access to the JS token cache.

**Two traps that cost real time:**

- **Tauri renames command ARGUMENTS from camelCase, but not struct FIELDS.** Passing
  `{ authUrl, apiUrl, powersyncUrl }` into a Rust struct with snake_case fields fails to
  deserialize, `connect` errors, and — because `app.tsx` used to swallow the error — the app looks
  merely "offline" forever. Fixed with `#[serde(rename_all = "camelCase")]` on `Urls`, and
  `connectDb()` failures are now logged rather than discarded.
- **`WEB_ORIGINS` only ever ADDS.** The desktop origins are unconditional in both servers, not a
  fallback used when the variable is blank: an operator setting it to add a staging domain would
  otherwise silently break every desktop client, which is the same
  CORS-failure-that-looks-like-an-auth-bug this configuration exists to avoid.
- The web bundle must not carry any of this. `@powersync-platform` (aliased in `vite.config.ts`
  per mode) picks exactly one implementation, so `grep -l tauri dist/assets/*.js` is empty for the
  browser build and there is no service worker in the desktop one.

Verified end to end: sign-up from `tauri://localhost` → 200 with `set-auth-token`; that token → JWT
→ `POST /bootstrap` 200 → `POST /sync/upload` 200 → rows in Postgres → synced back into the shell's
own SQLite file.
