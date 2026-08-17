import { expect, test } from "./fixtures";

/**
 * Solo use — a card's fields are edited in its detail dialog (Trello-style: click the card),
 * and the values persist across reload and show up in the Table view.
 *
 * Assignee is picked from the workspace's members rather than typed, so a solo user assigns to
 * themselves; the due date carries an optional time (see e2e/due-and-assignee.spec.ts).
 */
test.describe("board card editing", () => {
  test("set a card's due date and assignee (persists, shows in table)", async ({
    authedPage: page,
    user,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click(); // defaults to board
    // Adding a card opens its detail straight away, so capture stays one flow.
    await page.getByTestId("board-col-todo").getByRole("button", { name: "+ Add card" }).click();
    await page.getByTestId("item-detail").waitFor();

    await page.getByTestId("detail-due-date").fill("2026-07-20");
    await page.getByLabel("Card assignee").selectOption(user.email);
    await expect(page.getByTestId("detail-due-date")).toHaveValue("2026-07-20");
    await expect(page.getByLabel("Card assignee")).toHaveValue(user.email);

    // Closing gates on the write reaching the replica: the card's chips render from the
    // reactive query, so they only appear once the row was actually updated.
    await page.getByRole("button", { name: "Close card" }).click();
    const card = page.getByTestId("board-col-todo").getByTestId("board-card").first();
    await expect(card).toContainText("Due Jul 20");
    await expect(card).toContainText(user.email);

    // Persists across reload (collection still opens on the board).
    await page.reload();
    const reopened = page.getByTestId("board-col-todo").getByTestId("board-card").first();
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await reopened.click();
    await expect(page.getByTestId("detail-due-date")).toHaveValue("2026-07-20");
    await expect(page.getByLabel("Card assignee")).toHaveValue(user.email);
    await page.getByRole("button", { name: "Close card" }).click();

    // Same values in the Table view (one primitive, many views).
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByTestId("table");
    await expect(table.locator('input[type="date"]').first()).toHaveValue("2026-07-20");
    await expect(table.getByLabel("Row assignee").first()).toHaveValue(user.email);
  });
});
