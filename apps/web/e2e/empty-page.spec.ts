import { expect, test } from "./fixtures";
import { clickNewPage } from "./helpers/pages";

/**
 * A blank page is blank.
 *
 * Opening a new page used to present a Summarize button that silently did nothing and a comment
 * box inviting discussion of an empty document. Both belong to a page that exists yet.
 */
test.describe("empty page", () => {
  test("offers no furniture until the page has something on it", async ({ authedPage: page }) => {
    await clickNewPage(page);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("comment-section")).toHaveCount(0);
    await expect(page.getByTestId("summarize-page")).toHaveCount(0);

    await editor.click();
    await editor.pressSequentially("a first thought");

    // Not on the visit the page was made in, even once written on: it began a moment ago.
    await page.waitForTimeout(1500); // the first save lands
    await expect(page.getByTestId("comment-section")).toHaveCount(0);

    // Leaving and coming back brings the comment box. (Summarize also needs an AI engine, which
    // the dev stack may not have — asserted in ai-compose.spec.ts, which stubs one.)
    await clickNewPage(page);
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled 2", { timeout: 20_000 });
    await page
      .getByTestId("page-tree")
      .getByRole("button", { name: "Untitled", exact: true })
      .click();
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled", { timeout: 20_000 });
    await expect(page.getByTestId("comment-section")).toBeVisible({ timeout: 15_000 });

    // Emptying it again does not take the thread away mid-conversation…
    await page.getByTestId("comment-section").getByRole("textbox").first().fill("worth keeping");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByText("worth keeping")).toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < "a first thought".length; i += 1) await page.keyboard.press("Backspace");
    await expect(page.getByTestId("comment-section")).toBeVisible();
  });
});
