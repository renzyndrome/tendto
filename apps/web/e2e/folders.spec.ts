import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * Folders in the Pages tree, worked like an editor's file explorer: the header's "New page" and
 * "New folder" create inside the highlighted folder, rows drag into and out of folders, and a
 * folder never shows up where a page is expected (search, links).
 */

/** The tree node (row plus its children) whose own row is named `name`. */
function node(page: Page, name: string): Locator {
  return page
    .getByTestId("tree-node")
    .filter({
      has: page.getByTestId("tree-row").getByRole("button", { name, exact: true }),
    })
    .last();
}

/** The row itself, for clicking, dragging and reading its kind. */
function row(page: Page, name: string): Locator {
  return page.getByTestId("tree-row").filter({
    has: page.getByRole("button", { name, exact: true }),
  });
}

async function newFolder(page: Page, name: string): Promise<void> {
  await page.getByRole("button", { name: "New folder" }).click();
  const input = page.getByRole("textbox", { name: "Folder name" });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(row(page, name)).toHaveAttribute("data-kind", "folder");
}

async function newPageTitled(page: Page, title: string): Promise<void> {
  const before = page.url();
  await page.getByRole("button", { name: "New page" }).click();
  // Wait for the NEW page's title: right after the click the previous page's title field can
  // still be on screen, and filling that one renames the wrong page.
  await expect(page).not.toHaveURL(before);
  const titleBox = page.getByTestId("page-title");
  await expect(titleBox).toHaveValue(/^Untitled/, { timeout: 20_000 });
  await titleBox.fill(title);
  await expect(row(page, title)).toBeVisible();
}

test.describe("folders", () => {
  test("a page made while a folder is highlighted lands inside it, and stays after reload", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Work ${stamp}`;
    const child = `Plan ${stamp}`;

    await newFolder(page, folder);
    // The new folder is the highlighted row, so "New page" goes into it.
    await expect(row(page, folder)).toHaveAttribute("data-selected", "true");
    await newPageTitled(page, child);
    await expect(
      node(page, folder).getByRole("button", { name: child, exact: true }),
    ).toBeVisible();

    await page.waitForTimeout(1500); // debounced title save + upload
    await page.reload();
    await expect(row(page, folder)).toHaveAttribute("data-kind", "folder", { timeout: 20_000 });
    await expect(
      node(page, folder).getByRole("button", { name: child, exact: true }),
    ).toBeVisible();
  });

  test("clicking empty space clears the highlight, so the next page lands at the top level", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Inbox ${stamp}`;
    const loose = `Loose ${stamp}`;

    await newFolder(page, folder);
    const tree = page.getByTestId("page-tree");
    const box = await tree.boundingBox();
    if (!box) throw new Error("page tree has no box");
    await tree.click({ position: { x: 10, y: box.height - 6 } });
    await expect(row(page, folder)).not.toHaveAttribute("data-selected", "true");

    await newPageTitled(page, loose);
    await expect(node(page, folder).getByRole("button", { name: loose, exact: true })).toHaveCount(
      0,
    );
  });

  test("drag a page into a folder, then back out to the top level", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Projects ${stamp}`;
    const moved = `Notes ${stamp}`;

    await newPageTitled(page, moved);
    await newFolder(page, folder); // the open page sits at the top level, so the folder does too

    await row(page, moved).dragTo(row(page, folder));
    await expect(
      node(page, folder).getByRole("button", { name: moved, exact: true }),
    ).toBeVisible();

    const tree = page.getByTestId("page-tree");
    const box = await tree.boundingBox();
    if (!box) throw new Error("page tree has no box");
    await row(page, moved).dragTo(tree, { targetPosition: { x: 10, y: box.height - 6 } });
    await expect(node(page, folder).getByRole("button", { name: moved, exact: true })).toHaveCount(
      0,
    );
    await expect(row(page, moved)).toBeVisible();
  });

  test("a row let go over the page body pastes nothing into it", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const open = `Body ${stamp}`;
    await newPageTitled(page, open);
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.pressSequentially("kept text");

    await row(page, open).dragTo(editor);
    await page.waitForTimeout(300);
    await expect(editor).toHaveText("kept text");
  });

  test("a folder cannot be dropped into its own subfolder", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const outer = `Outer ${stamp}`;
    const inner = `Inner ${stamp}`;

    await newFolder(page, outer);
    await newFolder(page, inner); // the outer folder is highlighted, so this nests
    await expect(node(page, outer).getByRole("button", { name: inner, exact: true })).toBeVisible();

    await row(page, outer).dragTo(row(page, inner));
    // Nothing moved: the outer folder is still at the top level, holding the inner one.
    await expect(node(page, outer).getByRole("button", { name: inner, exact: true })).toBeVisible();
    await expect(node(page, inner).getByRole("button", { name: outer, exact: true })).toHaveCount(
      0,
    );
  });

  test("rename by double-click; Escape on a new folder creates nothing", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const before = `Draft ${stamp}`;
    const after = `Final ${stamp}`;

    await newFolder(page, before);
    await row(page, before).getByRole("button", { name: before, exact: true }).dblclick();
    const input = page.getByRole("textbox", { name: "Folder name" });
    await input.fill(after);
    await input.press("Enter");
    await expect(row(page, after)).toHaveAttribute("data-kind", "folder");
    await expect(row(page, before)).toHaveCount(0);

    const folders = page.locator('[data-testid="tree-row"][data-kind="folder"]');
    const count = await folders.count();
    await page.getByRole("button", { name: "New folder" }).click();
    await page.getByRole("textbox", { name: "Folder name" }).fill("Never made");
    await page.getByRole("textbox", { name: "Folder name" }).press("Escape");
    await expect(page.getByRole("textbox", { name: "Folder name" })).toHaveCount(0);
    await expect(folders).toHaveCount(count);
  });

  test("deleting a folder removes the pages inside it", async ({ authedPage: page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const stamp = Date.now().toString(36);
    const folder = `Old ${stamp}`;
    const child = `Inside ${stamp}`;

    await newFolder(page, folder);
    await newPageTitled(page, child);

    await row(page, folder).hover();
    await row(page, folder).getByRole("button", { name: "Delete folder" }).click();
    await expect(row(page, folder)).toHaveCount(0);
    await expect(row(page, child)).toHaveCount(0);
  });

  test("a folder is not offered by search", async ({ authedPage: page }) => {
    const stem = `kiwi${Date.now().toString(36)}`;
    await newPageTitled(page, `${stem}page`);
    await newFolder(page, `${stem}folder`);
    await page.waitForTimeout(1000); // title save reaches the replica and the index

    await page.getByRole("button", { name: /search/i }).click();
    const dialog = page.getByRole("dialog", { name: "Search" });
    await dialog.getByPlaceholder("Search pages, items, blocks…").fill(stem);
    const results = dialog.getByTestId("search-results");
    await expect(results.getByText(`${stem}page`)).toBeVisible({ timeout: 10_000 });
    await expect(results.getByText(`${stem}folder`)).toHaveCount(0);
  });
});
