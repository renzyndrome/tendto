/**
 * better-auth configuration — TendTo's auth service.
 *
 * Tables live in the same Postgres as everything else (`npm run migrate` creates them).
 * The JWT plugin's JWKS endpoint (/api/auth/jwks) is what FastAPI and the PowerSync
 * service verify tokens against; the organization plugin owns orgs/invites/roles.
 */
import { betterAuth } from "better-auth";
import { bearer, jwt, organization } from "better-auth/plugins";
import { Pool } from "pg";

import { webOrigins } from "./origins.js";

const BASE_URL = process.env.AUTH_URL ?? "http://localhost:13001";

export const auth = betterAuth({
  baseURL: BASE_URL,
  secret: process.env.AUTH_SECRET,
  database: new Pool({
    connectionString:
      process.env.AUTH_DATABASE_URL ?? "postgresql://tendto:tendto@localhost:15432/tendto",
  }),
  // The web app AND the desktop shell's webview — see origins.ts.
  trustedOrigins: webOrigins(),
  emailAndPassword: { enabled: true },
  // TODO(phase-1): socialProviders (Google/GitHub), email delivery for invites/verification.
  plugins: [
    organization(),
    // Lets a client authenticate with `Authorization: Bearer <session token>` instead of the
    // session cookie. This exists for ONE caller: the desktop shell. Its webview runs on a
    // tauri:// origin, and a SameSite=Lax session cookie is never sent cross-site from there, so
    // cookie auth cannot work at all in the shell. The browser app is untouched and still uses
    // cookies; the token itself is the same session token, handed over in the `set-auth-token`
    // response header (exposed by CORS in index.ts).
    bearer(),
    jwt({
      jwt: {
        issuer: process.env.AUTH_ISSUER ?? BASE_URL,
        // Verified by FastAPI (app/auth.py) and PowerSync (infra/powersync/config.yaml).
        audience: process.env.AUTH_AUDIENCE ?? "tendto",
        expirationTime: "15m",
      },
    }),
  ],
});
