import { expect, test, type Page } from "./fixtures";

/**
 * Second brain, phase B — what points at this page.
 *
 * Backlinks come from a device-local index built by triggers, so the interesting cases are the
 * ones where that index has to keep up: a link made after the page was open, and a link removed.
 * Unlinked mentions are the separate, softer signal: the title written out as prose.
 */
test.describe("page connections", () => {
  const editorOf = (page: Page) => page.locator('[contenteditable="true"]').first();

  async function newPage(page: Page, title: string) {
    const before = page.url();
    await page.getByRole("button", { name: "New page" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled", { timeout: 20_000 });
    await page.getByTestId("page-title").fill(title);
    await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
  }

  /** Type a `[[` link to `target` at the caret. */
  async function linkTo(page: Page, target: string, lead: string) {
    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially(`${lead} [[`);
    await editor.pressSequentially(target.split(" ")[0]);
    const suggestion = page.locator(".bn-suggestion-menu").getByText(target, { exact: false });
    await expect(suggestion.first()).toBeVisible({ timeout: 10_000 });
    await suggestion.first().click();
    await expect(page.getByTestId("page-link")).toHaveText(target, { timeout: 10_000 });
    await page.waitForTimeout(1500); // debounced persist to the replica
  }

  async function openConnections(page: Page) {
    await expect(page.getByTestId("page-connections")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("connections-toggle").click();
  }

  test("shows who links here, and drops the link when it is removed", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const target = `Target ${stamp}`;
    const source = `Source ${stamp}`;

    await newPage(page, target);
    // A page nothing points at says nothing at all.
    await expect(page.getByTestId("page-connections")).toHaveCount(0);

    await newPage(page, source);
    await linkTo(page, target, "budget notes live in");

    await page.getByRole("button", { name: target }).click();
    await openConnections(page);
    const backlink = page.getByTestId("backlink-row");
    await expect(backlink).toHaveCount(1, { timeout: 20_000 });
    await expect(backlink).toContainText(source);
    await expect(backlink).toContainText("budget notes live in");

    // Following a backlink goes to the page that made it.
    await backlink.click();
    await expect(page.getByTestId("page-title")).toHaveValue(source, { timeout: 20_000 });

    // Remove the link; the index must forget it.
    const editor = editorOf(page);
    await editor.click();
    await page.keyboard.press("End");
    for (let i = 0; i < 3; i += 1) await page.keyboard.press("Backspace");
    await expect(page.getByTestId("page-link")).toHaveCount(0, { timeout: 10_000 });
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: target }).click();
    await expect(page.getByTestId("backlink-row")).toHaveCount(0, { timeout: 20_000 });
  });

  test("lists a page that writes the title without linking it", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const target = `Quarterly ${stamp}`;

    await newPage(page, target);
    await newPage(page, `Diary ${stamp}`);

    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially(`I should write up ${target} tomorrow`);
    await page.waitForTimeout(1500);

    await page.getByRole("button", { name: target }).click();
    await openConnections(page);
    const mention = page.getByTestId("mention-row");
    await expect(mention).toHaveCount(1, { timeout: 20_000 });
    await expect(mention).toContainText(`Diary ${stamp}`);
    // A mention is not a backlink; nobody linked anything.
    await expect(page.getByTestId("backlink-row")).toHaveCount(0);
  });
});
