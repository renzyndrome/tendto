import { expect, test } from "./fixtures";

/**
 * Solo use — custom kanban columns. A board starts with the default three, but you can add and
 * rename your own; the change persists and cards can be added to the new column.
 */
test.describe("custom kanban columns", () => {
  test("add and rename a board column; add a card to it (persists)", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();

    const columns = page.locator('[data-testid^="board-col-"]');
    await expect(columns).toHaveCount(3); // defaults: To do / In progress / Done

    // Add a column (appended last) and rename it.
    await page.getByRole("button", { name: "Add column" }).click();
    await expect(columns).toHaveCount(4);
    const newColLabel = columns.last().getByRole("textbox").first();
    await expect(newColLabel).toHaveValue("New column");
    await newColLabel.fill("Review");
    await newColLabel.blur();
    await page.waitForTimeout(800); // persist config

    // Add a card into the new column.
    await columns.last().getByRole("button", { name: "+ Add card" }).click();
    await expect(columns.last().getByTestId("board-card")).toHaveCount(1);

    // The custom column + its card survive a reload.
    await page.reload();
    await expect(columns).toHaveCount(4, { timeout: 20_000 });
    await expect(columns.last().getByRole("textbox").first()).toHaveValue("Review");
    await expect(columns.last().getByTestId("board-card")).toHaveCount(1);
  });
});
