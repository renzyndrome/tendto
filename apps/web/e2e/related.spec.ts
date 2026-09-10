import { expect, test, type Page } from "./fixtures";

/**
 * Second brain, phase C — related pages.
 *
 * Nobody links these together; the words do. Two pages that keep using the same distinctive
 * vocabulary should find each other, and a page about something else should not be dragged in.
 */
test.describe("related pages", () => {
  const editorOf = (page: Page) => page.locator('[contenteditable="true"]').first();

  async function newPage(page: Page, title: string, body: string) {
    const before = page.url();
    await page.getByRole("button", { name: "New page" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled", { timeout: 20_000 });
    await page.getByTestId("page-title").fill(title);
    await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially(body);
    await page.waitForTimeout(1500); // debounced persist to the replica
  }

  test("surfaces a page that shares vocabulary, and ignores one that does not", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    // A nonsense word so the match cannot come from anything else in the workspace.
    const topic = `zorbicalt${stamp}`;
    /*
     * The run stamp is glued INTO each title rather than added as its own word. Titles are
     * matched too, so a shared "Notes 1a2b3c" / "Grocery 1a2b3c" suffix is a real term the three
     * pages have in common, and the unrelated page was legitimately pulled in by it.
     */
    const notes = `Notes${stamp}`;
    const review = `Review${stamp}`;
    const grocery = `Grocery${stamp}`;

    await newPage(page, notes, `the ${topic} process depends on ${topic} timing`);
    await newPage(page, review, `reviewing ${topic} again because ${topic} matters`);
    await newPage(page, grocery, "milk bread apples and a bag of rice");

    // Open the first page and look at what the panel suggests.
    await page.getByRole("button", { name: notes }).click();
    await expect(page.getByTestId("page-connections")).toBeVisible({ timeout: 20_000 });
    await page.getByTestId("connections-toggle").click();

    const related = page.getByTestId("related-row");
    await expect(related).toHaveCount(1, { timeout: 20_000 });
    await expect(related).toContainText(review);
    // The page about groceries shares no vocabulary and must not be suggested.
    await expect(page.getByTestId("page-connections")).not.toContainText(grocery);

    // Following a suggestion opens that page.
    await related.click();
    await expect(page.getByTestId("page-title")).toHaveValue(review, { timeout: 20_000 });
  });
});
