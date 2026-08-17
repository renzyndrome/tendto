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

/**
 * A page body is the same primitive (and the same component) as a card description, so it hit
 * the same bug: only the FIRST save of a block ever stuck, because the upsert relied on
 * `rowsAffected`, which PowerSync's view-backed tables always report as 0. Editing twice is the
 * only way to catch it — a single edit followed by a reload passes either way.
 */
test.describe("editor — repeated saves", () => {
  test("a second edit to the same block also persists", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    await editor.click();
    await editor.pressSequentially("alpha");
    // Let the debounced save land, so the block exists in the replica...
    await page.waitForTimeout(1200);
    // ...then edit the SAME block again.
    await editor.pressSequentially("-bravo");
    await page.waitForTimeout(1200);

    await page.reload();
    const reloaded = page.locator('[contenteditable="true"]').first();
    await expect(reloaded).toContainText("alpha-bravo", { timeout: 30_000 });
  });
});
