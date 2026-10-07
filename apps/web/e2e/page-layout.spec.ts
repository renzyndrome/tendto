import { expect, test } from "./fixtures";

/**
 * A page's title and body share one left edge. BlockNote insets its text 54px for the drag
 * handle; without the page column absorbing that gutter, the body sat visibly indented from the
 * title above it. The column sits a short, fixed distance from the sidebar instead of centering.
 * Checked at a wide and a narrow main area, and the narrow one must not scroll sideways (the
 * gutter stays inside the column).
 */
test.describe("page layout", () => {
  test("title and body text start at the same x", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially("aligned body text");

    for (const width of [1600, 900]) {
      await page.setViewportSize({ width, height: 900 });

      const titleX = await page
        .getByTestId("page-title")
        .evaluate((el) => el.getBoundingClientRect().left);
      const bodyX = await page
        .locator(".bn-inline-content")
        .first()
        .evaluate((el) => el.getBoundingClientRect().left);
      expect(Math.abs(bodyX - titleX), `misaligned at ${width}px`).toBeLessThanOrEqual(1);

      // Anchored to the sidebar, not centered: the gap stays the same however wide the window.
      const mainX = await page.locator("main").evaluate((el) => el.getBoundingClientRect().left);
      expect(titleX - mainX, `gap from sidebar at ${width}px`).toBeLessThanOrEqual(130);

      const overflow = await page.locator("main").evaluate((el) => el.scrollWidth - el.clientWidth);
      expect(overflow, `horizontal scroll at ${width}px`).toBe(0);
    }
  });
});
