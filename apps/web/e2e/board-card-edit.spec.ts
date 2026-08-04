import { expect, test } from "./fixtures";

/**
 * Solo use — edit a kanban card's due date + assignee directly on the board (expand the card),
 * not only in the Table view. Values persist across reload and show up in the table.
 *
 * Assignee is picked from the workspace's members rather than typed, so a solo user assigns to
 * themselves; the due date carries an optional time (see e2e/due-and-assignee.spec.ts).
 */
test.describe("board card editing", () => {
  test("set a card's due date and assignee on the board (persists, shows in table)", async ({
    authedPage: page,
    user,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click(); // defaults to board
    const todo = page.getByTestId("board-col-todo");
    await todo.getByRole("button", { name: "+ Add card" }).click();

    const card = todo.getByTestId("board-card").first();
    await card.getByRole("button", { name: "Edit card details" }).click();
    await card.getByTestId("card-due-date").fill("2026-07-20");
    const assignee = card.getByLabel("Card assignee");
    await assignee.selectOption(user.email);
    // Confirm both landed in the open card (gates on the debounced/immediate writes) before reload.
    await expect(card.getByTestId("card-due-date")).toHaveValue("2026-07-20");
    await expect(assignee).toHaveValue(user.email);

    // Then gate on the write reaching the replica: collapsing shows chips rendered from the
    // reactive query, so they only appear once the row was actually updated.
    await card.getByRole("button", { name: "Hide card details" }).click();
    await expect(card).toContainText("Due Jul 20");
    await expect(card).toContainText(user.email);

    // Persists across reload (collection still opens on the board).
    await page.reload();
    const reopened = page.getByTestId("board-col-todo").getByTestId("board-card").first();
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await reopened.getByRole("button", { name: "Edit card details" }).click();
    await expect(reopened.getByTestId("card-due-date")).toHaveValue("2026-07-20");
    await expect(reopened.getByLabel("Card assignee")).toHaveValue(user.email);

    // Same values in the Table view (one primitive, many views).
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByTestId("table");
    await expect(table.locator('input[type="date"]').first()).toHaveValue("2026-07-20");
    await expect(table.getByLabel("Row assignee").first()).toHaveValue(user.email);
  });
});
