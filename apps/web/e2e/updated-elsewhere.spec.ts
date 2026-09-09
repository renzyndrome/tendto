import { expect, test } from "./fixtures";
import { signInAs } from "./helpers/api";

/**
 * Phase 3 — sync hardening. An open editor is hydrated once, so an edit made on another device
 * lands in the replica underneath it and the next local save silently wins. The editor now says
 * so, and offers to re-read. A notice, not a merge: nothing is applied without asking.
 */
test.describe("updated elsewhere", () => {
  test("an open page reports another device's edit and reloads on request", async ({
    authedPage: page,
    browser,
    user,
  }) => {
    const mine = `mine-${Date.now().toString(36)}`;
    const theirs = `theirs-${Date.now().toString(36)}`;

    // Device 1 writes, and STAYS on the page — never reloading is the whole point.
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(mine);
    await page.waitForTimeout(1500); // debounced save + upload

    // Nothing has happened elsewhere yet: our own autosave must not accuse itself.
    await expect(page.getByTestId("updated-elsewhere")).toBeHidden();

    const device2 = await browser.newContext();
    try {
      expect((await signInAs(device2.request, user.email, user.password)).ok()).toBeTruthy();
      const page2 = await device2.newPage();
      await page2.goto("/");
      await page2.getByRole("button", { name: "Untitled" }).first().click();

      const editor2 = page2.locator('[contenteditable="true"]').first();
      await expect(editor2).toContainText(mine, { timeout: 30_000 });
      await editor2.click();
      await page2.keyboard.press("End");
      await page2.keyboard.type(theirs);
      await page2.waitForTimeout(1500);

      // Device 1 is told — without its content being swapped out from under the caret.
      await expect(page.getByTestId("updated-elsewhere")).toBeVisible({ timeout: 30_000 });
      await expect(editor).not.toContainText(theirs);

      // …and re-reads on request.
      await page.getByRole("button", { name: "Reload" }).click();
      await expect(page.locator('[contenteditable="true"]').first()).toContainText(theirs, {
        timeout: 20_000,
      });
      await expect(page.getByTestId("updated-elsewhere")).toBeHidden();
    } finally {
      await device2.close();
    }
  });
});
