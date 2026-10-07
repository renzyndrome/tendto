import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * The sidebar trees' working tools: header order, Undo after delete, remembered folders,
 * keyboard keys, the right-click menu, reordering by drag, and Favorites.
 */

function pages(page: Page): Locator {
  return page.getByRole("region", { name: "Pages" });
}

function row(page: Page, name: string): Locator {
  return pages(page)
    .getByTestId("tree-row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

/** The tree node (row plus its children) whose own row is named `name`. */
function node(page: Page, name: string): Locator {
  return pages(page)
    .getByTestId("tree-node")
    .filter({ has: page.getByTestId("tree-row").getByRole("button", { name, exact: true }) })
    .last();
}

/** Top-level row names in the Pages tree, in the order they are drawn. */
async function topLevelNames(page: Page): Promise<string[]> {
  return page
    .getByTestId("page-tree")
    .locator(':scope > [data-testid="tree-node"] > [data-testid="tree-row"] [data-tree-main]')
    .allInnerTexts();
}

async function newFolder(page: Page, name: string): Promise<void> {
  await pages(page).getByRole("button", { name: "New folder" }).click();
  const input = page.getByRole("textbox", { name: "Folder name" });
  await input.fill(name);
  await input.press("Enter");
  await expect(row(page, name)).toHaveAttribute("data-kind", "folder");
}

async function newPageTitled(page: Page, title: string): Promise<void> {
  const before = page.url();
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page).not.toHaveURL(before);
  const titleBox = page.getByTestId("page-title");
  await expect(titleBox).toHaveValue(/^Untitled/, { timeout: 20_000 });
  await titleBox.fill(title);
  await expect(row(page, title)).toBeVisible();
}

/** Clear the highlight so the next "New page" lands at the top level. */
async function clearHighlight(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Calendar" }).click();
}

test.describe("sidebar tools", () => {
  test("the folder icon comes first in both headers", async ({ authedPage: page }) => {
    for (const [section, item] of [
      ["Pages", "New page"],
      ["Collections", "New collection"],
    ]) {
      const labels = await page
        .getByRole("region", { name: section })
        .getByRole("button", { name: /^New / })
        .evaluateAll((buttons) => buttons.map((b) => b.getAttribute("aria-label")));
      expect(labels).toEqual(["New folder", item]);
    }
  });

  test("delete offers Undo, and the delete lands once the window closes", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const keep = `Keep ${stamp}`;
    const gone = `Gone ${stamp}`;
    await newPageTitled(page, keep);
    await clearHighlight(page);
    await newPageTitled(page, gone);

    // No confirm dialog any more: the row goes at once and the bar offers Undo.
    let asked = false;
    page.on("dialog", (dialog) => {
      asked = true;
      void dialog.dismiss();
    });
    await row(page, keep).hover();
    await row(page, keep).getByRole("button", { name: "Delete page" }).click();
    await expect(row(page, keep)).toHaveCount(0);
    const toast = page.getByTestId("undo-toast");
    await expect(toast).toContainText(`"${keep}" deleted.`);
    await toast.getByRole("button", { name: "Undo" }).click();
    await expect(row(page, keep)).toBeVisible();
    await expect(toast).toHaveCount(0);

    // Deleting the open page leaves it; once the window passes the delete is real.
    await row(page, gone).getByRole("button", { name: gone, exact: true }).click();
    await row(page, gone).hover();
    await row(page, gone).getByRole("button", { name: "Delete page" }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(toast).toHaveCount(0, { timeout: 15_000 });
    await page.waitForTimeout(1500); // upload
    await page.reload();
    await expect(row(page, keep)).toBeVisible({ timeout: 20_000 });
    await expect(row(page, gone)).toHaveCount(0);
    expect(asked).toBe(false);
  });

  test("Back to a page waiting on Undo shows no editor to type into", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const doomed = `Doomed ${stamp}`;
    await newPageTitled(page, doomed);
    await row(page, doomed).hover();
    await row(page, doomed).getByRole("button", { name: "Delete page" }).click();
    await expect(page).toHaveURL(/\/$/);
    // Back inside the app, within the Undo window. (A full reload ends the window by design.)
    await page.goBack();
    await expect(page.getByText("Page deleted.")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator('[contenteditable="true"]')).toHaveCount(0);
  });

  test("opening a page by its link opens the closed folder it sits in", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Hidden ${stamp}`;
    const child = `Linked ${stamp}`;
    await newFolder(page, folder);
    await newPageTitled(page, child);
    const url = page.url();
    await clearHighlight(page);

    await row(page, folder).getByRole("button", { name: "Collapse" }).click();
    await expect(row(page, child)).toHaveCount(0);
    await page.goto(url); // a fresh load: the rows arrive after the route does
    await expect(row(page, child)).toHaveAttribute("data-selected", "true", { timeout: 20_000 });
  });

  test("a closed folder stays closed after a reload", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const folder = `Shut ${stamp}`;
    const child = `Inner ${stamp}`;
    await newFolder(page, folder);
    await newPageTitled(page, child);
    await clearHighlight(page);

    await row(page, folder).getByRole("button", { name: "Collapse" }).click();
    await expect(row(page, child)).toHaveCount(0);
    await page.reload();
    await expect(row(page, folder)).toBeVisible({ timeout: 20_000 });
    await expect(row(page, child)).toHaveCount(0);
    await row(page, folder).getByRole("button", { name: "Expand" }).click();
    await expect(row(page, child)).toBeVisible();
  });

  test("arrow keys walk the tree; Left closes a folder; F2 renames it", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Keys ${stamp}`;
    const child = `Walk ${stamp}`;
    await newFolder(page, folder);
    await newPageTitled(page, child);

    // Focus the folder row, then Down lands on its page.
    await row(page, folder).getByRole("button", { name: folder, exact: true }).focus();
    await page.keyboard.press("ArrowDown");
    await expect(row(page, child)).toHaveAttribute("data-selected", "true");
    await expect(row(page, child).getByRole("button", { name: child, exact: true })).toBeFocused();

    // Left from the page goes up to the folder; Left again closes it.
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, folder)).toHaveAttribute("data-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(row(page, child)).toHaveCount(0);
    await page.keyboard.press("ArrowRight");
    await expect(row(page, child)).toBeVisible();

    await page.keyboard.press("F2");
    const input = page.getByRole("textbox", { name: "Folder name" });
    await expect(input).toBeFocused();
    await input.fill(`Renamed ${stamp}`);
    await input.press("Enter");
    await expect(row(page, `Renamed ${stamp}`)).toBeVisible();
  });

  test("right-click Move to files a page into a folder", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const page1 = `Loose ${stamp}`;
    const folder = `Target ${stamp}`;
    await newPageTitled(page, page1);
    await newFolder(page, folder); // the open page is top level, so the folder is too

    await row(page, page1).click({ button: "right" });
    const menu = page.getByTestId("tree-menu");
    await menu.getByRole("menuitem", { name: "Move to…" }).click();
    await menu.getByRole("menuitem", { name: folder }).click();
    await expect(menu).toHaveCount(0);
    await expect(
      node(page, folder).getByRole("button", { name: page1, exact: true }),
    ).toBeVisible();
  });

  test("drag onto a row's top edge reorders, and the order survives a reload", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const [a, b, c] = ["A", "B", "C"].map((letter) => `${letter} ${stamp}`);
    for (const name of [a, b, c]) {
      await newPageTitled(page, name);
      await clearHighlight(page);
    }
    expect(await topLevelNames(page)).toEqual([a, b, c]);

    await row(page, c).dragTo(row(page, a), { targetPosition: { x: 40, y: 3 } });
    await expect.poll(() => topLevelNames(page)).toEqual([c, a, b]);

    await page.waitForTimeout(1500); // upload
    await page.reload();
    await expect(row(page, a)).toBeVisible({ timeout: 20_000 });
    expect(await topLevelNames(page)).toEqual([c, a, b]);
  });

  test("a starred page shows in Favorites, opens from there, and unstars", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const starred = `Star ${stamp}`;
    await newPageTitled(page, starred);
    // Nothing starred yet: no Favorites section at all.
    await expect(page.getByRole("region", { name: "Favorites" })).toHaveCount(0);

    await row(page, starred).hover();
    await row(page, starred).getByRole("button", { name: "Add to favorites" }).click();
    const favorites = page.getByRole("region", { name: "Favorites" });
    await expect(favorites.getByRole("button", { name: starred, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Calendar" }).click();
    await favorites.getByRole("button", { name: starred, exact: true }).click();
    await expect(page.getByTestId("page-title")).toHaveValue(starred, { timeout: 20_000 });

    // Starred on the server too: it is still there after a reload.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(favorites.getByRole("button", { name: starred, exact: true })).toBeVisible({
      timeout: 20_000,
    });

    await favorites.getByTestId("favorite-row").hover();
    await favorites.getByRole("button", { name: "Remove from favorites" }).click();
    await expect(page.getByRole("region", { name: "Favorites" })).toHaveCount(0);
  });
});
