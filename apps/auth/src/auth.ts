/**
 * better-auth configuration — TendTo's auth service.
 *
 * Tables live in the same Postgres as everything else (`npm run migrate` creates them).
 * The JWT plugin's JWKS endpoint (/api/auth/jwks) is what FastAPI and the PowerSync
 * service verify tokens against; the organization plugin owns orgs/invites/roles.
 */
import { betterAuth } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { Pool } from "pg";

const BASE_URL = process.env.AUTH_URL ?? "http://localhost:13001";
const WEB_URL = process.env.WEB_URL ?? "http://localhost:15173";

export const auth = betterAuth({
  baseURL: BASE_URL,
  secret: process.env.AUTH_SECRET,
  database: new Pool({
    connectionString:
      process.env.AUTH_DATABASE_URL ?? "postgresql://tendto:tendto@localhost:15432/tendto",
  }),
  trustedOrigins: [WEB_URL],
  emailAndPassword: { enabled: true },
  // TODO(phase-1): socialProviders (Google/GitHub), email delivery for invites/verification.
  plugins: [
    organization(),
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
