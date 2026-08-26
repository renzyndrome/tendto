import type { APIRequestContext } from "@playwright/test";

/**
 * API helpers that reuse the browser context's session cookie (so they act as the signed-in user).
 * Pass `page.request` from an authed page: the better-auth session cookie → a short JWT → Bearer.
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
const API = process.env.VITE_API_URL ?? "http://localhost:18000";

/** Sign in an existing user in this context (sets the session cookie) — e.g. a second "device". */
export async function signInAs(
  request: APIRequestContext,
  email: string,
  password: string,
) {
  return request.post(`${AUTH}/api/auth/sign-in/email`, { data: { email, password } });
}

/** Exchange the session cookie for a short-lived JWT (the same flow the web app uses). */
export async function getToken(request: APIRequestContext): Promise<string> {
  const res = await request.get(`${AUTH}/api/auth/token`);
  if (!res.ok()) return "";
  const body = (await res.json()) as { token?: string };
  return body.token ?? "";
}

/** Authenticated POST to the FastAPI backend as the current user. */
export async function apiPost(
  request: APIRequestContext,
  path: string,
  data: Record<string, unknown> = {},
) {
  const token = await getToken(request);
  return request.post(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    data,
  });
}

/** Authenticated GET to the FastAPI backend as the current user. */
export async function apiGet(request: APIRequestContext, path: string) {
  const token = await getToken(request);
  return request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

/**
 * Whether a REAL AI engine is configured on the running API.
 *
 * Specs that would call one use this to skip. Two reasons, and either alone is enough: a real
 * model makes assertions non-deterministic, and the suite must never spend the operator's AI
 * subscription. Anything that can be stubbed is stubbed instead (see ai-compose.spec.ts).
 */
export async function aiEngineConfigured(request: APIRequestContext): Promise<boolean> {
  const res = await apiGet(request, "/ai/status");
  if (!res.ok()) return false;
  const body = (await res.json()) as { available?: boolean };
  return body.available === true;
}
