import { expect, test } from "./fixtures";

/**
 * Second brain, phase A — `[[` page links.
 *
 * The load-bearing assertion is that `[[` opens the menu MID-SENTENCE. BlockNote 0.51.4 cannot
 * match a two-character trigger anywhere but a block boundary, so the menu is wired to a single
 * "[" plus a `shouldOpen` guard (see components/editor/page-link-menu.tsx). If someone
 * "simplifies" that back to triggerCharacter="[[", this spec is what fails.
 */
test.describe("page links", () => {
  const editorOf = (page: import("@playwright/test").Page) =>
    page.locator('[contenteditable="true"]').first();

  /**
   * Create a page, name it, and return once the rename has reached the replica.
   *
   * Waits for the URL to actually change before touching the title. The previous page's editor
   * and title box are still mounted for a moment after "New page" is clicked, so filling the
   * title straight away renames the page the user just left instead of the new one.
   */
  async function newPage(page: import("@playwright/test").Page, title: string) {
    const before = page.url();
    await page.getByRole("button", { name: "New page" }).click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
    await expect(page).toHaveURL(/\/p\//, { timeout: 20_000 });
    await expect(editorOf(page)).toBeVisible({ timeout: 20_000 });
    // `createPage` names a new page "Untitled" — that value appearing is the proof that the
    // title box has remounted for the NEW page rather than still showing the previous one.
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled", { timeout: 20_000 });
    await page.getByTestId("page-title").fill(title);
    // The rename is debounced (400ms) and the sidebar is the replica's own view of it.
    await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
  }

  test("links one page to another and follows the link", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const target = `Alpha ${stamp}`;
    const renamed = `Renamed ${stamp}`;

    await newPage(page, target);
    await newPage(page, `Source ${stamp}`);

    // Type the trigger MID-PARAGRAPH, after real words — the case the naive trigger breaks on.
    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially("see also [[");
    await editor.pressSequentially("Alpha");

    // Scoped to the menu: the sidebar also has a button with this page's name, and clicking
    // that would navigate away instead of inserting a link.
    const suggestion = page.locator(".bn-suggestion-menu").getByText(target, { exact: false });
    await expect(suggestion.first()).toBeVisible({ timeout: 10_000 });
    await suggestion.first().click();

    // The chip is in the document, and the brackets are gone.
    const chip = page.getByTestId("page-link");
    await expect(chip).toHaveText(target, { timeout: 10_000 });
    await expect(editor).toContainText("see also");
    await expect(editor).not.toContainText("[[");
    await page.waitForTimeout(1500); // persist to the replica

    // It survives a reload (i.e. it round-tripped through the `content` JSON column).
    await page.reload();
    await expect(page.getByTestId("page-link")).toHaveText(target, { timeout: 30_000 });

    // Following the link lands on the target page.
    const sourceUrl = page.url();
    await page.getByTestId("page-link").click();
    await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(sourceUrl);
    await expect(page.getByTestId("page-title")).toHaveValue(target, { timeout: 20_000 });

    // Renaming the target updates the chip — the link stores an id, not a copy of the title.
    await page.getByTestId("page-title").fill(renamed);
    await page.waitForTimeout(900);

    await page.getByRole("button", { name: `Source ${stamp}` }).click();
    await expect(page.getByTestId("page-link")).toHaveText(renamed, { timeout: 20_000 });
  });

  test("a link to a deleted page goes inert rather than opening an empty page", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const doomed = `Doomed ${stamp}`;

    await newPage(page, doomed);
    await newPage(page, `Keeper ${stamp}`);

    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially("points at [[");
    await editor.pressSequentially("Doomed");
    const suggestion = page.locator(".bn-suggestion-menu").getByText(doomed, { exact: false });
    await expect(suggestion.first()).toBeVisible({ timeout: 10_000 });
    await suggestion.first().click();
    await expect(page.getByTestId("page-link")).toHaveText(doomed, { timeout: 10_000 });
    await page.waitForTimeout(1500);

    // Delete the target from the sidebar (it asks for confirmation with a native dialog).
    page.once("dialog", (dialog) => void dialog.accept());
    const row = page.getByRole("button", { name: doomed });
    await row.hover();
    await page
      .locator("div.group", { has: page.getByRole("button", { name: doomed }) })
      .getByRole("button", { name: "Delete page" })
      .click();
    await expect(row).toHaveCount(0, { timeout: 20_000 });

    // The chip must mark itself dead and refuse to navigate: opening an unknown page id renders
    // an empty editor, and typing there would insert blocks whose page Postgres no longer has,
    // wedging this device's upload queue.
    // Deleting a page returns to the index, so reopen the page that holds the link.
    await page.getByRole("button", { name: `Keeper ${stamp}` }).click();
    const chip = page.getByTestId("page-link");
    await expect(chip).toHaveAttribute("data-missing", "true", { timeout: 20_000 });

    const url = page.url();
    await chip.click();
    await page.waitForTimeout(1500);
    expect(page.url()).toBe(url);
  });

  test("a single bracket does not open the menu", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    await newPage(page, `Solo ${stamp}`);

    const editor = editorOf(page);
    await editor.click();
    await editor.pressSequentially("cost [1] per unit");
    await page.waitForTimeout(500);

    // No menu, and the text the user actually typed is intact.
    await expect(page.locator(".bn-suggestion-menu")).toHaveCount(0);
    await expect(editor).toContainText("cost [1] per unit");
  });
});
