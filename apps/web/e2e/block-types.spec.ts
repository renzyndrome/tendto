import { expect, test } from "./fixtures";

/**
 * Solo use — the curated block set. BlockNote's markdown input rules turn "# ", "- ", and "[] "
 * into a heading, a bullet-list item, and a check-list item (the "type to insert anything" feel).
 */
test.describe("block types", () => {
  test("markdown input rules create heading, bullet, and checkbox blocks", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();

    await editor.pressSequentially("# A heading");
    await expect(editor.locator('[data-content-type="heading"]')).toContainText("A heading");

    await editor.press("Enter");
    await editor.pressSequentially("- a bullet");
    await expect(editor.locator('[data-content-type="bulletListItem"]')).toContainText("a bullet");

    await editor.press("Enter");
    await editor.pressSequentially("[] a task");
    await expect(editor.locator('[data-content-type="checkListItem"]')).toContainText("a task");
  });
});
