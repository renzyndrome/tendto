import { expect, test } from "./fixtures";
import { signInAs } from "./helpers/api";
import { seedOnboardingComplete } from "./helpers/onboarding";

/**
 * Phase 1 — the crown jewel: the whole local-first loop.
 *  1. Create a page + type → the edit persists across a reload (durable in the local replica).
 *  2. A SECOND browser context signed in as the same user (a fresh replica) receives the page and
 *     its text via PowerSync — the cross-device promise.
 */
test.describe("sync loop", () => {
  test("edit persists across reload and syncs to a second device", async ({
    authedPage,
    browser,
    user,
  }) => {
    const page = authedPage;
    const marker = `sync-marker-${Date.now().toString(36)}`;

    // Create a page and type into the editor.
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(marker);
    await expect(editor).toContainText(marker);

    // Give the debounced save (~500ms) + upload time, then reload: the replica is durable.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(marker, {
      timeout: 20_000,
    });

    // Second "device": a brand-new context (fresh OPFS replica) signed in as the same user.
    const device2 = await browser.newContext();
    try {
      const res = await signInAs(device2.request, user.email, user.password);
      expect(res.ok(), `device-2 sign-in failed: ${res.status()}`).toBeTruthy();

      const page2 = await device2.newPage();
      await seedOnboardingComplete(page2); // second device also skips the welcome modal
      await page2.goto("/");
      // The page created on device 1 shows up in device 2's sidebar via sync…
      await page2.getByRole("button", { name: "Untitled" }).first().click();
      // …and opening it shows the text typed on device 1.
      await expect(page2.locator('[contenteditable="true"]').first()).toContainText(marker, {
        timeout: 30_000,
      });
    } finally {
      await device2.close();
    }
  });
});
