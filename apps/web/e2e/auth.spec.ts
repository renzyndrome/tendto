import { expect, test } from "./fixtures";
import { makeUser } from "./helpers/data";

/**
 * Phase 1 — auth. Real UI flow through better-auth: sign up → land in the app with a workspace,
 * sign out → back to the auth screen, sign in again → back in the app.
 */
test.describe("auth", () => {
  test("sign up, sign out, and sign back in", async ({ page }) => {
    const user = makeUser();
    await page.goto("/");

    // Auth screen (logged out): the app shell must NOT be visible.
    await expect(page.getByRole("heading", { name: "TendTo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New page" })).toHaveCount(0);

    // Switch to sign-up and create the account.
    await page.getByRole("button", { name: /create an account/i }).click();
    await page.getByPlaceholder("you@example.com").fill(user.email);
    await page.getByPlaceholder("Password").fill(user.password);
    await page.getByRole("button", { name: "Create account" }).click();

    // Lands in the app: workspace bootstrapped + synced ⇒ the sidebar renders.
    await expect(page.getByRole("button", { name: "New page" })).toBeVisible({ timeout: 30_000 });

    // Sign out → back to the auth screen.
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

    // Sign back in with the same credentials.
    await page.getByPlaceholder("you@example.com").fill(user.email);
    await page.getByPlaceholder("Password").fill(user.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByRole("button", { name: "New page" })).toBeVisible({ timeout: 30_000 });
  });
});
