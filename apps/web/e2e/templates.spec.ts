import { expect, test } from "./fixtures";
import { expectNewPageOpened } from "./helpers/pages";

/**
 * Page templates: a blank page offers a short row of them, picking one fills the body through
 * the normal save path, and the row never appears on a page that already holds something.
 */
test.describe("page templates", () => {
  test("a blank page offers templates, and a picked one fills it and survives a reload", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await expectNewPageOpened(page);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const row = page.getByTestId("page-templates");
    await expect(row).toBeVisible();
    for (const label of ["Meeting notes", "Sermon notes", "Daily journal", "Project brief"]) {
      await expect(row.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await row.getByRole("button", { name: "Meeting notes", exact: true }).click();
    await expect(editor.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await expect(editor.getByRole("heading", { name: "Action items" })).toBeVisible();
    await expect(page.getByTestId("page-templates")).toHaveCount(0);

    await page.waitForTimeout(1500); // debounced save
    await page.reload();

    const reloaded = page.locator('[contenteditable="true"]').first();
    await expect(reloaded.getByRole("heading", { name: "Agenda" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(reloaded.getByRole("heading", { name: "Attendees" })).toBeVisible();
    await expect(page.getByTestId("page-templates")).toHaveCount(0);
  });

  test("a page with typed content never shows the row", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await expectNewPageOpened(page);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("page-templates")).toBeVisible();

    await editor.click();
    await editor.pressSequentially("own words");
    // Gone with the first keystrokes, not a save later.
    await expect(page.getByTestId("page-templates")).toHaveCount(0, { timeout: 2_000 });

    await page.waitForTimeout(1500); // debounced save
    await page.reload();

    const reloaded = page.locator('[contenteditable="true"]').first();
    await expect(reloaded).toContainText("own words", { timeout: 20_000 });
    await expect(page.getByTestId("page-templates")).toHaveCount(0);
  });
});
