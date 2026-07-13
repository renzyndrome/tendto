import { expect, test } from "./fixtures";

/**
 * Solo use — edit a kanban card's due date + assignee directly on the board (expand the card),
 * not only in the Table view. Values persist across reload and show up in the table.
 */
test.describe("board card editing", () => {
  test("set a card's due date and assignee on the board (persists, shows in table)", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click(); // defaults to board
    const todo = page.getByTestId("board-col-todo");
    await todo.getByRole("button", { name: "+ Add card" }).click();

    const card = todo.getByTestId("board-card").first();
    await card.getByRole("button", { name: "Edit card details" }).click();
    await card.getByLabel("Card due date").fill("2026-07-20");
    const assignee = card.getByPlaceholder("—");
    await assignee.fill("Alex");
    await assignee.blur();
    // Confirm both landed in the open card (gates on the debounced/immediate writes) before reload.
    await expect(card.getByLabel("Card due date")).toHaveValue("2026-07-20");
    await expect(assignee).toHaveValue("Alex");
    await page.waitForTimeout(1200);

    // Persists across reload (collection still opens on the board).
    await page.reload();
    const reopened = page.getByTestId("board-col-todo").getByTestId("board-card").first();
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await reopened.getByRole("button", { name: "Edit card details" }).click();
    await expect(reopened.getByLabel("Card due date")).toHaveValue("2026-07-20");
    await expect(reopened.getByPlaceholder("—")).toHaveValue("Alex");

    // Same values in the Table view (one primitive, many views).
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByTestId("table");
    await expect(table.locator('input[type="date"]').first()).toHaveValue("2026-07-20");
    await expect(table.getByPlaceholder("—")).toHaveValue("Alex");
  });
});
