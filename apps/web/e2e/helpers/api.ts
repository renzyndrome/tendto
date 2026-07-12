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
