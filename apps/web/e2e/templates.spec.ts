import type { Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { clickNewPage, createNamedPage, expectNewPageOpened } from "./helpers/pages";

/**
 * Page templates: a blank page offers a short row of them, picking one fills the body through
 * the normal save path, and the row never appears on a page that already holds something.
 *
 * Custom templates are made in Personalization, either blank or as a copy of the open page, and
 * edited in their own editor. They sit in the row beside the built-in ones, which can be edited,
 * deleted and restored there too.
 */
/** Open Personalization on its Templates section, which starts collapsed. */
async function openTemplates(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Personalization" }).click();
  const section = page.getByTestId("pref-section-templates");
  if ((await section.getAttribute("aria-expanded")) !== "true") await section.click();
  await expect(page.getByTestId("template-settings")).toBeVisible();
}

test.describe("page templates", () => {
  test("a blank page offers templates, and a picked one fills it and survives a reload", async ({
    authedPage: page,
  }) => {
    await clickNewPage(page);
    await expectNewPageOpened(page);
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });

    const row = page.getByTestId("page-templates");
    await expect(row).toBeVisible();
    for (const label of [
      "Meeting notes",
      "Sermon notes",
      "Daily journal",
      "Weekly review",
      "Project brief",
    ]) {
      await expect(row.getByRole("button", { name: label, exact: true })).toBeVisible();
    }

    await row.getByRole("button", { name: "Meeting notes", exact: true }).click();
    await expect(editor.getByRole("heading", { name: "Agenda" })).toBeVisible();
    await expect(editor.getByRole("heading", { name: "Action items" })).toBeVisible();
    await expect(page.getByTestId("page-templates")).toHaveCount(0);

    // The caret waits after the first field label, and what is typed there is not bold.
    await page.keyboard.type("Oct 13");
    await expect(editor.locator('[data-content-type="paragraph"]').first()).toContainText(
      "Date: Oct 13",
    );
    await expect(editor.locator("strong", { hasText: "Oct 13" })).toHaveCount(0);

    await page.waitForTimeout(1500); // debounced save
    await page.reload();

    const reloaded = page.locator('[contenteditable="true"]').first();
    await expect(reloaded.getByRole("heading", { name: "Agenda" })).toBeVisible({
      timeout: 20_000,
    });
    await expect(reloaded.getByRole("heading", { name: "Decisions" })).toBeVisible();
    await expect(page.getByTestId("page-templates")).toHaveCount(0);
  });

  test("a page with typed content never shows the row", async ({ authedPage: page }) => {
    await clickNewPage(page);
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

  test("a page saved as a template starts a new page with its content", async ({
    authedPage: page,
  }) => {
    const name = `Weekly ${Date.now().toString(36)}`;
    await createNamedPage(page, name);
    const editor = page.locator('[contenteditable="true"]').first();
    await editor.click();
    await editor.pressSequentially("Wins this week");
    await page.waitForTimeout(1500); // debounced save, so the copy reads the body

    await openTemplates(page);
    const settings = page.getByTestId("template-settings");
    await settings.getByRole("button", { name: "Save page as template" }).click();
    await expect(settings.getByRole("button", { name, exact: true })).toBeVisible();
    await page.getByTestId("pref-cancel").click();

    await clickNewPage(page);
    await expectNewPageOpened(page);
    const row = page.getByTestId("page-templates");
    await row.getByRole("button", { name, exact: true }).click();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText("Wins this week");
    await expect(row).toHaveCount(0);

    await page.waitForTimeout(1500); // debounced save
    await page.reload();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText("Wins this week", {
      timeout: 20_000,
    });

    // The source page keeps its own body. Had the template carried its block ids, the new
    // page's save would have moved those blocks out of the source page.
    await page.getByTestId("page-tree").getByRole("button", { name, exact: true }).click();
    await expect(page.getByTestId("page-title")).toHaveValue(name, { timeout: 20_000 });
    await expect(page.locator('[contenteditable="true"]').first()).toContainText("Wins this week");
  });

  test("a new template is named, written in its own editor, and can be deleted", async ({
    authedPage: page,
  }) => {
    const name = `Retro ${Date.now().toString(36)}`;
    await openTemplates(page);
    const settings = page.getByTestId("template-settings");
    await settings.getByRole("button", { name: "New template" }).click();
    const field = settings.getByRole("textbox", { name: "Template name" });
    await expect(field).toBeFocused();
    await field.fill(name);
    await field.press("Enter");

    // Opened in the template editor, with the panel closed.
    await expect(page.getByTestId("personalization")).toHaveCount(0);
    const templateEditor = page.getByTestId("template-editor");
    await expect(templateEditor).toBeVisible({ timeout: 20_000 });
    await expect(page.getByTestId("template-name")).toHaveValue(name);
    const body = templateEditor.locator('[contenteditable="true"]').first();
    await body.click();
    await body.pressSequentially("What went well");
    await page.waitForTimeout(1500); // debounced save

    await page.reload();
    await expect(templateEditor.locator('[contenteditable="true"]').first()).toContainText(
      "What went well",
      { timeout: 20_000 },
    );

    // Offered on a blank page, and fills it.
    await clickNewPage(page);
    await expectNewPageOpened(page);
    await page.getByTestId("page-templates").getByRole("button", { name, exact: true }).click();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText("What went well");

    // Deleted in Personalization: gone from the list, and from the next blank page.
    await openTemplates(page);
    await settings.getByRole("button", { name: `Delete template ${name}` }).click();
    await expect(settings.getByRole("button", { name, exact: true })).toHaveCount(0);
    await page.getByTestId("pref-cancel").click();

    await clickNewPage(page);
    const row = page.getByTestId("page-templates");
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByRole("button", { name: "Meeting notes", exact: true })).toBeVisible();
    await expect(row.getByRole("button", { name, exact: true })).toHaveCount(0);
  });

  test("a built-in template can be edited, deleted, and restored", async ({ authedPage: page }) => {
    await openTemplates(page);
    const settings = page.getByTestId("template-settings");

    // Editing a built-in opens it in the template editor as the user's own copy.
    await settings.getByRole("button", { name: "Meeting notes", exact: true }).click();
    const templateEditor = page.getByTestId("template-editor");
    await expect(templateEditor).toBeVisible({ timeout: 20_000 });
    const nameBox = page.getByTestId("template-name");
    await expect(nameBox).toHaveValue("Meeting notes");
    await nameBox.fill("Team sync");
    await templateEditor.getByRole("heading", { name: "Agenda" }).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" (15 min)");
    await page.waitForTimeout(1500); // debounced saves

    // A blank page offers the edited copy in the built-in's place.
    await clickNewPage(page);
    await expectNewPageOpened(page);
    const row = page.getByTestId("page-templates");
    await expect(row.getByRole("button", { name: "Meeting notes", exact: true })).toHaveCount(0);
    await row.getByRole("button", { name: "Team sync", exact: true }).click();
    await expect(
      page.locator('[contenteditable="true"]').first().getByRole("heading", {
        name: "Agenda (15 min)",
      }),
    ).toBeVisible();

    // Deleted: gone from the list, and still gone after a reload.
    await openTemplates(page);
    await settings.getByRole("button", { name: "Delete template Team sync" }).click();
    await expect(settings.getByRole("button", { name: "Team sync", exact: true })).toHaveCount(0);
    const restore = settings.getByRole("button", { name: "Restore built-in templates" });
    await expect(restore).toBeVisible({ timeout: 15_000 }); // once the Undo window closes
    await page.getByTestId("pref-cancel").click();

    await page.reload();
    await clickNewPage(page);
    await expect(row).toBeVisible({ timeout: 20_000 });
    await expect(row.getByRole("button", { name: "Team sync", exact: true })).toHaveCount(0);
    await expect(row.getByRole("button", { name: "Meeting notes", exact: true })).toHaveCount(0);

    // Restored: back as defined, under its own name.
    await openTemplates(page);
    await restore.click();
    await expect(
      settings.getByRole("button", { name: "Meeting notes", exact: true }),
    ).toBeVisible();
    await expect(restore).toHaveCount(0);
  });
});
