import { expect, test } from "./fixtures";

/**
 * Solo use — managing content: delete a page and delete a collection (both confirm-gated), and
 * nesting: create a subpage under a page, then collapse the parent to hide it. Row actions are
 * hover-revealed (keeps the sidebar calm), so tests hover the row before clicking.
 */
test.describe("manage pages & collections", () => {
  test("delete a page", async ({ authedPage: page }) => {
    page.on("dialog", (d) => void d.accept());
    const name = `Del ${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(name);
    await page.waitForTimeout(900);

    const link = page.getByRole("button", { name });
    await expect(link).toBeVisible();
    await link.hover();
    await page.getByRole("button", { name: "Delete page" }).click();

    await expect(page.getByRole("button", { name })).toHaveCount(0);
  });

  test("delete a collection", async ({ authedPage: page }) => {
    page.on("dialog", (d) => void d.accept());

    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "Blank board" }).click();
    const link = page.getByRole("button", { name: "Untitled", exact: true });
    await expect(link).toBeVisible();
    await link.hover();
    await page.getByRole("button", { name: "Delete collection" }).click();

    await expect(page.getByText("No collections yet")).toBeVisible();
  });

  test("nest a subpage under a page (collapse hides it)", async ({ authedPage: page }) => {
    const parent = `Parent ${Date.now().toString(36)}`;
    const child = `Child ${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(parent);
    await page.waitForTimeout(900);

    // Add a subpage under the parent (navigates to the new child), then name it. Wait for the
    // navigation to land (a new page has an EMPTY title — "Untitled" is only the placeholder)
    // before typing, so we don't rename the parent by mistake.
    await page.getByRole("button", { name: parent }).hover();
    await page.getByRole("button", { name: "Add subpage" }).click();
    await expect(page.getByTestId("page-title")).toHaveValue("");
    await page.getByTestId("page-title").fill(child);
    await page.waitForTimeout(900);

    await expect(page.getByRole("button", { name: parent })).toBeVisible();
    await expect(page.getByRole("button", { name: child })).toBeVisible();

    // The parent now has a collapse toggle; collapsing hides the nested child.
    await page.getByRole("button", { name: "Collapse" }).click();
    await expect(page.getByRole("button", { name: child })).toHaveCount(0);
  });
});
