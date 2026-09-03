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

  test("index tracks edits and clearing, and matches by prefix", async ({ authedPage: page }) => {
    const stem = `zeta${Date.now().toString(36)}`;
    const first = `${stem}alpha`;
    const edited = `${first}omega`;

    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially(first);
    await page.waitForTimeout(1500); // debounced persist to the replica (500ms) + margin

    const openSearch = async (term: string) => {
      await page.getByRole("button", { name: /search/i }).click();
      const dialog = page.getByRole("dialog", { name: "Search" });
      await dialog.getByPlaceholder("Search pages, items, blocks…").fill(term);
      return dialog;
    };
    const closeSearch = async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog", { name: "Search" })).toBeHidden();
    };
    // Put the caret at the end of the block's existing text. BlockNote does NOT honour a plain
    // Ctrl+A as "select the block's text", so an edit is made by appending, never by
    // select-and-replace (that leaves a stray empty paragraph and drops the first keystroke).
    const caretToEnd = async () => {
      await editor.getByText(stem, { exact: false }).first().click();
      await page.keyboard.press("End");
    };

    // A PREFIX of the word finds it — the property LIKE could not give us.
    let dialog = await openSearch(stem);
    await expect(dialog.getByText(first).first()).toBeVisible({ timeout: 10_000 });
    await closeSearch();

    // EDIT the same block (the second write — one-shot specs hide index-staleness bugs here).
    await caretToEnd();
    await page.keyboard.type("omega");
    await page.waitForTimeout(1500);

    dialog = await openSearch(edited);
    await expect(dialog.getByText(edited).first()).toBeVisible({ timeout: 10_000 });
    await closeSearch();

    // CLEAR the text: the block must drop out of the index entirely.
    await caretToEnd();
    for (let i = 0; i < edited.length; i += 1) await page.keyboard.press("Backspace");
    await page.waitForTimeout(1500);

    dialog = await openSearch(stem);
    await expect(dialog.getByText(stem, { exact: false })).toHaveCount(0);
  });
});
