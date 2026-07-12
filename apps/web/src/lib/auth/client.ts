/**
 * better-auth React client — the app's only channel to the auth service (a "true API call"
 * surface: auth, not content). Content never flows through here; it lives in the PowerSync
 * replica. The server enables email/password plus the organization and JWT plugins, so the
 * client mirrors that with `organizationClient()` and `jwtClient()`.
 */
import { jwtClient, organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_AUTH_URL as string,
  plugins: [organizationClient(), jwtClient()],
});

export const useSession = authClient.useSession;
export const signIn = authClient.signIn;
export const signUp = authClient.signUp;
export const signOut = authClient.signOut;
