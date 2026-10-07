import { expect, test } from "./fixtures";

/**
 * A blank page is blank.
 *
 * Opening a new page used to present a Summarize button that silently did nothing and a comment
 * box inviting discussion of an empty document. Both belong to a page that exists yet.
 */
test.describe("empty page", () => {
  test("offers no furniture until the page has something on it", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    await expect(page.getByTestId("comment-section")).toHaveCount(0);
    await expect(page.getByTestId("summarize-page")).toHaveCount(0);

    await editor.click();
    await editor.pressSequentially("a first thought");

    // The comment box arrives with the page, once the first save has landed. (Summarize also
    // needs an AI engine, which the dev stack may not have — asserted in ai-compose.spec.ts,
    // which stubs one.)
    await expect(page.getByTestId("comment-section")).toBeVisible({ timeout: 15_000 });

    // Emptying it again does not take the thread away mid-conversation…
    await page.getByTestId("comment-section").getByRole("textbox").first().fill("worth keeping");
    await page.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByText("worth keeping")).toBeVisible({ timeout: 10_000 });

    for (let i = 0; i < "a first thought".length; i += 1) await page.keyboard.press("Backspace");
    await expect(page.getByTestId("comment-section")).toBeVisible();
  });
});
