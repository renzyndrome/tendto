/**
 * TendTo auth service — a thin Hono app on Bun's built-in server (dev :13001, prod :3001).
 *
 * Infrastructure, not product code: all business logic stays in FastAPI. This process
 * only serves /api/auth/* (sessions, orgs/invites, JWT + JWKS for API/PowerSync).
 */
import { Hono } from "hono";
import { cors } from "hono/cors";

import { auth } from "./auth.js";

const WEB_URL = process.env.WEB_URL ?? "http://localhost:15173";
// Dev default avoids clashing with other local projects; prod sets AUTH_PORT=3001.
const PORT = Number(process.env.AUTH_PORT ?? 13001);

const app = new Hono();

app.use(
  "/api/auth/*",
  cors({
    origin: WEB_URL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.on(["GET", "POST"], "/api/auth/*", (c) => auth.handler(c.req.raw));

app.get("/health", (c) => c.json({ status: "ok" }));

console.info(`tendto-auth listening on :${PORT}`);

// Bun picks up the default export and serves it.
export default { port: PORT, fetch: app.fetch };
