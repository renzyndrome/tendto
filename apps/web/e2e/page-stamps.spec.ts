import { expect, test } from "./fixtures";

/**
 * A page says when it was made and when it was last touched.
 *
 * "Edited" is not read off the page row: writing the body stamps the block rows and leaves the
 * page row alone, so the line has to take the later of the two. That is what the second half of
 * this test pins.
 */
test.describe("page stamps", () => {
  test("shows when a page was created, and notices when its body changes", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const stamps = page.getByTestId("page-stamps");
    await expect(stamps).toBeVisible({ timeout: 20_000 });
    await expect(stamps).toContainText("Created");
    // A page written in one sitting should not tell you it was edited a moment after it began.
    await expect(stamps).not.toContainText("Edited");

    // The precise instant is one hover away.
    await expect(stamps.locator("[title]").first()).toHaveAttribute("title", /\d/);
  });
});
