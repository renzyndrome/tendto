import { test as base, expect, type Page } from "@playwright/test";

import { makeUser, type TestUser } from "./helpers/data";

/**
 * `authedPage` fixture: signs up a FRESH user via the better-auth API (setting the session cookie
 * in the browser context), opens the app, and waits for the full boot to complete —
 * session → POST /bootstrap → PowerSync sync-down → the workspace's sidebar renders. Reaching a
 * visible "New page" button proves the whole auth+bootstrap+sync loop for every spec that builds
 * on it, and each spec gets its own empty workspace (isolation on the shared Postgres).
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";

interface Fixtures {
  user: TestUser;
  authedPage: Page;
}

export const test = base.extend<Fixtures>({
  user: async ({}, use) => {
    await use(makeUser());
  },
  authedPage: async ({ page, user }, use) => {
    const res = await page.request.post(`${AUTH}/api/auth/sign-up/email`, {
      data: { email: user.email, password: user.password, name: user.name },
    });
    expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    await page.goto("/");
    // Workspace provisioned + synced to the replica when the sidebar's "New page" is visible.
    await expect(page.getByRole("button", { name: "New page" })).toBeVisible({ timeout: 30_000 });

    await use(page);
  },
});

export { expect };
