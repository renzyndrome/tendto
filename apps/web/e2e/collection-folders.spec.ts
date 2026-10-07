import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * Folders in the Collections section: the same explorer as Pages (folders.spec.ts), over the
 * collections table. What is specific to collections: only folders nest, and a folder must never
 * be offered as a place to file a task (it holds no items).
 */

function section(page: Page): Locator {
  return page.getByRole("region", { name: "Collections" });
}

/** The tree node (row plus its children) whose own row is named `name`. */
function node(page: Page, name: string): Locator {
  return section(page)
    .getByTestId("tree-node")
    .filter({ has: page.getByTestId("tree-row").getByRole("button", { name, exact: true }) })
    .last();
}

function row(page: Page, name: string): Locator {
  return section(page)
    .getByTestId("tree-row")
    .filter({ has: page.getByRole("button", { name, exact: true }) });
}

async function newFolder(page: Page, name: string): Promise<void> {
  await section(page).getByRole("button", { name: "New folder" }).click();
  const input = page.getByRole("textbox", { name: "Folder name" });
  await expect(input).toBeFocused();
  await input.fill(name);
  await input.press("Enter");
  await expect(row(page, name)).toHaveAttribute("data-kind", "folder");
}

/** Create a collection from the header and name it on its own page. */
async function newCollectionNamed(page: Page, name: string): Promise<void> {
  const before = page.url();
  await section(page).getByRole("button", { name: "New collection" }).click();
  await expect(page).not.toHaveURL(before);
  await expect(page).toHaveURL(/\/c\//);
  const nameBox = page.getByRole("textbox", { name: "Collection name" });
  await expect(nameBox).toHaveValue("Untitled", { timeout: 20_000 });
  await nameBox.fill(name);
  await nameBox.press("Enter");
  await expect(row(page, name)).toHaveAttribute("data-kind", "collection");
}

test.describe("collection folders", () => {
  test("a collection made while a folder is highlighted lands inside it, and stays after reload", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Clients ${stamp}`;
    const child = `Acme ${stamp}`;

    await newFolder(page, folder);
    await expect(row(page, folder)).toHaveAttribute("data-selected", "true");
    await newCollectionNamed(page, child);
    await expect(
      node(page, folder).getByRole("button", { name: child, exact: true }),
    ).toBeVisible();

    await page.waitForTimeout(1500); // upload, then the round trip back
    await page.reload();
    await expect(row(page, folder)).toHaveAttribute("data-kind", "folder", { timeout: 20_000 });
    await expect(
      node(page, folder).getByRole("button", { name: child, exact: true }),
    ).toBeVisible();
  });

  test("drag a collection into a folder, then back out to the top level", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const folder = `Archive ${stamp}`;
    const moved = `Tasks ${stamp}`;

    await newCollectionNamed(page, moved);
    await newFolder(page, folder); // the open collection is top level, so the folder is too

    await row(page, moved).dragTo(row(page, folder));
    await expect(
      node(page, folder).getByRole("button", { name: moved, exact: true }),
    ).toBeVisible();

    // Out again via the section header, which is top level too. (The empty space under this
    // tree, the other way out, sits at the bottom of the sidebar and can be scrolled away.)
    await row(page, moved).dragTo(section(page).getByText("Collections", { exact: true }));
    await expect(node(page, folder).getByRole("button", { name: moved, exact: true })).toHaveCount(
      0,
    );
    await expect(row(page, moved)).toBeVisible();
  });

  test("a page cannot be dropped into a collection folder", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const folder = `Boards ${stamp}`;
    await newFolder(page, folder);

    await page.getByRole("button", { name: "New page" }).click();
    const title = page.getByTestId("page-title");
    await expect(title).toHaveValue(/^Untitled/, { timeout: 20_000 });
    const pageName = `Loose page ${stamp}`;
    await title.fill(pageName);
    const pageRow = page
      .getByRole("region", { name: "Pages" })
      .getByTestId("tree-row")
      .filter({ has: page.getByRole("button", { name: pageName, exact: true }) });
    await expect(pageRow).toBeVisible();

    await pageRow.dragTo(row(page, folder));
    await expect(
      node(page, folder).getByRole("button", { name: pageName, exact: true }),
    ).toHaveCount(0);
    await expect(pageRow).toBeVisible();
  });

  test("the calendar never offers a folder as a place to file a task", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    await newFolder(page, `Folder ${stamp}`);
    await newCollectionNamed(page, `Only ${stamp}`);

    await page.getByRole("button", { name: "Calendar" }).click();
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
      d.getDate(),
    ).padStart(2, "0")}`;
    await page.getByTestId(`cal-day-${today}`).click();
    await page.getByTestId("day-grid").click({ position: { x: 120, y: 9 * 56 + 4 } });
    await expect(page.getByTestId("quick-create-time")).toBeVisible();
    // One real collection and one folder: still a single choice, so no picker at all.
    await expect(page.getByTestId("quick-create-collection")).toHaveCount(0);
  });

  test("deleting a folder removes the collections inside it", async ({ authedPage: page }) => {
    page.on("dialog", (dialog) => void dialog.accept());
    const stamp = Date.now().toString(36);
    const folder = `Old ${stamp}`;
    const child = `Inside ${stamp}`;

    await newFolder(page, folder);
    await newCollectionNamed(page, child);

    await row(page, folder).hover();
    await row(page, folder).getByRole("button", { name: "Delete folder" }).click();
    await expect(row(page, folder)).toHaveCount(0);
    await expect(row(page, child)).toHaveCount(0);
  });

  test("a folder's URL shows no board", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const folder = `Direct ${stamp}`;
    await newFolder(page, folder);
    const id = await node(page, folder).getAttribute("data-id");
    if (!id) throw new Error("folder row has no id");

    await page.goto(`/c/${id}`);
    await expect(page.getByText("Folder. Collections listed in the sidebar.")).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole("textbox", { name: "Collection name" })).toHaveCount(0);
  });
});
