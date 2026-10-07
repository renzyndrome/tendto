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

  test("re-opening a page that already has content does not accuse anyone", async ({
    authedPage: page,
  }) => {
    const marker = `solo-${Date.now().toString(36)}`;

    /*
     * The single-device case, which the test above structurally cannot cover: it only ever
     * looks at a page created seconds earlier, whose body is still empty at the moment the
     * watcher mounts. The notice used to appear on EVERY page that already had content, on one
     * machine, because the watching query reports an empty result while it is still loading and
     * that empty document was adopted as the baseline.
     */
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(marker);
    await page.waitForTimeout(1500); // debounced save

    // Leave, so coming back is a fresh mount onto a body that is already there.
    await page.getByRole("button", { name: "Calendar" }).click();
    await page.getByRole("button", { name: "Untitled" }).first().click();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(marker, {
      timeout: 20_000,
    });

    // Long enough for the query to settle, which is when the false notice used to appear.
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("updated-elsewhere")).toBeHidden();

    // A full reload is the other path that remounts the watcher over existing content.
    await page.reload();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(marker, {
      timeout: 30_000,
    });
    await page.waitForTimeout(2500);
    await expect(page.getByTestId("updated-elsewhere")).toBeHidden();
  });
});
