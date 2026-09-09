/**
 * TendTo auth service — a thin Hono app on Bun's built-in server (dev :13001, prod :3001).
 *
 * Infrastructure, not product code: all business logic stays in FastAPI. This process
 * only serves /api/auth/* (sessions, orgs/invites, JWT + JWKS for API/PowerSync).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import { auth } from "./auth.js";
import { isDesktopOrigin, webOrigins } from "./origins.js";

// Dev default avoids clashing with other local projects; prod sets AUTH_PORT=3001.
const PORT = Number(process.env.AUTH_PORT ?? 13001);

const app = new Hono();

app.use(
  "/api/auth/*",
  cors({
    // A list, not a string: the desktop shell's webview is a different origin — see origins.ts.
    origin: webOrigins(),
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
    // NOTE: `set-auth-token` is deliberately NOT exposed here — see the middleware below.
  }),
);

/**
 * Hand the session token to the desktop shell, and to nothing else.
 *
 * better-auth's `bearer()` plugin attaches the raw session token to EVERY response that sets the
 * session cookie — its `after` hook matches unconditionally, regardless of whether the request
 * used a bearer at all. That is what the desktop needs (its `tauri://` origin can never receive a
 * SameSite cookie), but for the browser app it would be a straight downgrade: the session would
 * stop being HttpOnly-only and become a portable credential that any script on the page could
 * read, turning a contained XSS into account takeover from anywhere.
 *
 * So the header is stripped for every origin except the shell's, and only exposed to CORS there.
 * The browser app keeps the cookie it always had, and never sees the token.
 */
app.use("/api/auth/*", async (c, next) => {
  await next();
  // The plugin sets both the token and its own Access-Control-Expose-Headers, so both are
  // rewritten here rather than merely added to — otherwise a browser client would still be told
  // to expose a header it must never receive.
  if (isDesktopOrigin(c.req.header("origin"))) {
    c.res.headers.set("Access-Control-Expose-Headers", "set-auth-token");
  } else {
    c.res.headers.delete("set-auth-token");
    c.res.headers.delete("Access-Control-Expose-Headers");
  }
});

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/health", (c) => c.json({ status: "ok" }));

console.info(`tendto-auth listening on :${PORT}`);

// Bun picks up the default export and serves it.
export default { port: PORT, fetch: app.fetch };
