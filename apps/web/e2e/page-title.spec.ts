import { expect, test } from "./fixtures";

/**
 * Solo use — a page can be named. The title is editable in the editor, shows in the sidebar, and
 * persists across a reload.
 */
test.describe("page title", () => {
  test("rename a page; the title shows in the sidebar and persists", async ({
    authedPage: page,
  }) => {
    const name = `Note ${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(name);
    await page.waitForTimeout(900); // debounced title save

    // Sidebar reflects the title (its page link is now named).
    await expect(page.getByRole("button", { name })).toBeVisible();

    // Persists across reload.
    await page.reload();
    await expect(page.getByTestId("page-title")).toHaveValue(name, { timeout: 20_000 });
  });
});
