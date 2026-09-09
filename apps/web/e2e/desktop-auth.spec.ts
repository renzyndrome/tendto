/**
 * How the auth service hands out credentials, per origin.
 *
 * The desktop shell cannot use the session cookie — its webview runs on `tauri://localhost`, and a
 * SameSite=Lax cookie is never sent cross-site — so better-auth's `bearer()` plugin returns the
 * session token in a `set-auth-token` header instead.
 *
 * The catch, and the reason this spec exists: that plugin's response hook matches EVERY response
 * that sets the session cookie, regardless of origin or of whether a bearer was used. Left alone,
 * the browser app's own sign-in would hand the raw session token to page JavaScript — turning a
 * contained XSS into a portable credential that works from any device, which is precisely what
 * HttpOnly exists to prevent. `apps/auth/src/index.ts` strips the header for every origin but the
 * shell's; this spec is what stops that stripping being removed by accident.
 *
 * No browser is involved: `request` talks to the auth service directly, which is the only way to
 * set an arbitrary Origin.
 */
import { expect, test } from "@playwright/test";

import { makeUser } from "./helpers/data";

const AUTH_URL = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
const WEB_ORIGIN = process.env.WEB_URL ?? "http://localhost:15173";
const DESKTOP_ORIGIN = "tauri://localhost";

async function signUpFrom(request: import("@playwright/test").APIRequestContext, origin: string) {
  const user = makeUser();
  const response = await request.post(`${AUTH_URL}/api/auth/sign-up/email`, {
    headers: { "Content-Type": "application/json", Origin: origin },
    data: { email: user.email, password: user.password, name: user.name },
  });
  expect(response.status(), `sign-up from ${origin} should be allowed`).toBe(200);
  return response.headers();
}

test.describe("credentials by origin", () => {
  test("the browser app never receives the session token", async ({ request }) => {
    const headers = await signUpFrom(request, WEB_ORIGIN);

    expect(headers["set-auth-token"], "the web app must stay cookie-only").toBeUndefined();
    expect(
      headers["access-control-expose-headers"],
      "nothing should tell a browser to read a token header",
    ).toBeUndefined();
    // It still gets a session — just the HttpOnly cookie it always had.
    expect(headers["set-cookie"]).toBeTruthy();
    expect(headers["access-control-allow-origin"]).toBe(WEB_ORIGIN);
  });

  test("the desktop shell receives the session token, and may read it", async ({ request }) => {
    const headers = await signUpFrom(request, DESKTOP_ORIGIN);

    expect(headers["set-auth-token"], "the shell has no other way to authenticate").toBeTruthy();
    // Without this the browser hides the header and desktop sign-in "succeeds" while every later
    // request is anonymous.
    expect(headers["access-control-expose-headers"]).toContain("set-auth-token");
    expect(headers["access-control-allow-origin"]).toBe(DESKTOP_ORIGIN);
  });

  test("the session token authenticates the API, as the shell relies on", async ({ request }) => {
    const headers = await signUpFrom(request, DESKTOP_ORIGIN);
    const sessionToken = headers["set-auth-token"];

    // Exactly what the Rust connector does: session token → short-lived JWT → FastAPI.
    const tokenResponse = await request.get(`${AUTH_URL}/api/auth/token`, {
      headers: { Authorization: `Bearer ${sessionToken}`, Origin: DESKTOP_ORIGIN },
    });
    expect(tokenResponse.ok()).toBe(true);
    const { token } = (await tokenResponse.json()) as { token: string };
    expect(token).toBeTruthy();

    const apiUrl = process.env.VITE_API_URL ?? "http://localhost:18000";
    const bootstrap = await request.post(`${apiUrl}/bootstrap`, {
      headers: { Authorization: `Bearer ${token}`, Origin: DESKTOP_ORIGIN },
      data: {},
    });
    expect(bootstrap.status(), "the desktop origin must survive the API's CORS too").toBe(200);
  });
});
