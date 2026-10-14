import { expect, type Page } from "@playwright/test";

/**
 * A blank page's own name: "Untitled", "Untitled 2", "Untitled 3"…
 *
 * Kept here rather than spelled out in each spec, because that name is a product decision and
 * it has already changed once. `createPage` in apps/web/src/lib/pages.ts is the source.
 */
export const AUTO_TITLE = /^Untitled(?: \d+)?$/;

/**
 * Wait until a freshly created page is open and ready to type into.
 *
 * The title carrying its auto name is the proof that the editor has remounted for the NEW page:
 * the one you just left is still on screen for a moment after "New page" is clicked, and filling
 * the title too early renames the wrong page.
 */
export async function expectNewPageOpened(page: Page): Promise<void> {
  await expect(page.getByTestId("page-title")).toHaveValue(AUTO_TITLE, { timeout: 20_000 });
}

/**
 * Click "New page" and press Enter in the name field it opens, leaving the name empty: the page
 * is made under its auto name and opened. Follow with `expectNewPageOpened` before typing.
 */
export async function clickNewPage(page: Page): Promise<void> {
  await page.getByRole("button", { name: "New page" }).click();
  const name = page.getByRole("textbox", { name: "Page name" });
  await expect(name).toBeFocused();
  await name.press("Enter");
}

/** Create a page and give it a name. Returns once the sidebar shows it under that name. */
export async function createNamedPage(page: Page, title: string): Promise<void> {
  await clickNewPage(page);
  await expectNewPageOpened(page);
  await page.getByTestId("page-title").fill(title);
  await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
}

/**
 * Make a page under `title` through the name field, then open it again. A page's comment thread
 * stays out of view on the visit it was made in, so a spec about comments starts from here.
 */
export async function createPageAndRevisit(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "New page" }).click();
  const name = page.getByRole("textbox", { name: "Page name" });
  await name.fill(title);
  await name.press("Enter");
  await expect(page.getByTestId("page-title")).toHaveValue(title, { timeout: 20_000 });
  await expect(page.getByTestId("comment-section")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("page-title")).toHaveValue(title, { timeout: 20_000 });
}
