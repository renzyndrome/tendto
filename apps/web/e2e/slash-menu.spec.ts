import { expect, test } from "./fixtures";

/**
 * Solo use — the "/" slash menu. Typing "/" opens BlockNote's insert menu; picking an item spawns
 * that block (Notion's "type / to insert anything"). Verifies the menu appears and inserts.
 */
test.describe("slash menu", () => {
  test("typing / opens the insert menu and spawns the chosen block", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();

    // Open + filter the slash menu, then pick Heading 1.
    await editor.pressSequentially("/head");
    const headingItem = page.getByText("Heading 1", { exact: true });
    await expect(headingItem).toBeVisible({ timeout: 10_000 });
    await headingItem.click();

    // The current block is now a heading; typing fills it.
    await editor.pressSequentially("Spawned via slash");
    await expect(editor.locator('[data-content-type="heading"]')).toContainText("Spawned via slash");
  });
});
