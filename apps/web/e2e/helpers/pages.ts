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

/** Create a page and give it a name. Returns once the sidebar shows it under that name. */
export async function createNamedPage(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "New page" }).click();
  await expectNewPageOpened(page);
  await page.getByTestId("page-title").fill(title);
  await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
}
