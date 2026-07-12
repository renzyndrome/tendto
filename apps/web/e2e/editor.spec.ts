import { expect, test } from "./fixtures";

/**
 * Phase 1 — the block editor. Typed content (across multiple blocks) survives a reload from the
 * local replica.
 */
test.describe("editor", () => {
  test("multi-block content persists across reload", async ({ authedPage: page }) => {
    const line1 = `heading-${Date.now().toString(36)}`;
    const line2 = "second paragraph";

    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    await editor.click();
    await editor.pressSequentially(line1);
    await editor.press("Enter");
    await editor.pressSequentially(line2);
    await expect(editor).toContainText(line1);
    await expect(editor).toContainText(line2);

    await page.waitForTimeout(1500); // debounced save + upload
    await page.reload();

    const reloaded = page.locator('[contenteditable="true"]').first();
    await expect(reloaded).toContainText(line1, { timeout: 20_000 });
    await expect(reloaded).toContainText(line2);
  });
});
