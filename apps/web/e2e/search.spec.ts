import { expect, test } from "./fixtures";

/**
 * Phase 3 — instant search. A block typed into a page is findable via the command palette, and
 * selecting the result navigates to the page.
 */
test.describe("search", () => {
  test("finds a block by content and navigates to its page", async ({ authedPage: page }) => {
    const marker = `find-${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(marker);
    await page.waitForTimeout(1500); // persist to the replica

    // Navigate away so the result click has somewhere to go.
    await page.getByRole("button", { name: "Calendar" }).click();

    // Open the palette and search.
    await page.getByRole("button", { name: /search/i }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByPlaceholder("Search pages, items, blocks…").fill(marker);

    const hit = dialog.getByText(marker).first();
    await expect(hit).toBeVisible({ timeout: 10_000 });
    await hit.click();

    // Landed on the page (editor with the marker).
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(marker, {
      timeout: 20_000,
    });
  });
});
