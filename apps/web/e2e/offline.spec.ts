import { expect, test } from "./fixtures";
import { signInAs } from "./helpers/api";
import { seedOnboardingComplete } from "./helpers/onboarding";

/**
 * Phase 1 — offline-first. Edit while the browser is offline (writes queue in the local replica),
 * then reconnect: the queued write uploads and reaches a second device. The airplane-mode promise.
 */
test.describe("offline", () => {
  test("edit made offline uploads on reconnect and reaches a second device", async ({
    authedPage: page,
    context,
    browser,
    user,
  }) => {
    const marker = `offline-${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    // Go offline, then edit — the app must stay fully usable (local-first).
    await context.setOffline(true);
    await editor.click();
    await editor.pressSequentially(marker);
    await expect(editor).toContainText(marker);
    await page.waitForTimeout(800); // debounced save into the local replica (still offline)

    // Reconnect — the queued write uploads.
    await context.setOffline(false);
    await page.waitForTimeout(2000);

    // A second device (fresh replica) receives the once-offline edit via sync.
    const device2 = await browser.newContext();
    try {
      expect((await signInAs(device2.request, user.email, user.password)).ok()).toBeTruthy();
      const page2 = await device2.newPage();
      await seedOnboardingComplete(page2); // second device also skips the welcome modal
      await page2.goto("/");
      await page2.getByRole("button", { name: "Untitled" }).first().click();
      await expect(page2.locator('[contenteditable="true"]').first()).toContainText(marker, {
        timeout: 30_000,
      });
    } finally {
      await device2.close();
    }
  });
});
