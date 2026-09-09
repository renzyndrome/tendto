/**
 * better-auth React client — the app's only channel to the auth service (a "true API call"
 * surface: auth, not content). Content never flows through here; it lives in the PowerSync
 * replica. The server enables email/password plus the organization and JWT plugins, so the
 * client mirrors that with `organizationClient()` and `jwtClient()`.
 */
import { jwtClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

import { isDesktop } from "../platform";
import { getSessionToken, setSessionToken } from "./session-token";

/**
 * How the client proves who it is.
 *
 * Browser: nothing — the session is an HttpOnly cookie the browser attaches on its own.
 *
 * Desktop: a bearer token. The Tauri webview serves the app from `tauri://localhost`, and a
 * SameSite=Lax session cookie is never sent cross-site from there, so cookie auth cannot work in
 * the shell at all. better-auth's `bearer()` plugin (enabled server-side) hands the session
 * token back in the `set-auth-token` header on sign-in/sign-up; we capture it and send it as
 * `Authorization: Bearer` from then on. `isDesktop` is a build-time constant, so the browser
 * bundle keeps the plain cookie client with none of this attached.
 */
const desktopFetchOptions = {
  auth: { type: "Bearer", token: () => getSessionToken() },
  onSuccess(context: { response: Response }) {
    const token = context.response.headers.get("set-auth-token");
    if (token) setSessionToken(token);
  },
} as const;

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_URL as string,
  plugins: [organizationClient(), jwtClient()],
  ...(isDesktop ? { fetchOptions: desktopFetchOptions } : {}),
});

export const useSession = authClient.useSession;
export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const signOut = authClient.signOut;
