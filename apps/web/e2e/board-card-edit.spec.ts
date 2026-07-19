import { expect, test } from "./fixtures";

/**
 * Task detail modal — open a kanban card, edit its due date, description, and assign a member,
 * then confirm it persists across reload and the same item shows in the Table view (one primitive,
 * many views).
 */
test.describe("task detail modal", () => {
  test("edit due date, description, and assignee; persists and shows across views", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "Task board" }).click(); // To do / In progress / Done
    const todo = page.getByTestId("board-col-todo");
    await todo.getByRole("button", { name: "+ Add card" }).click();

    // Open the card's detail modal.
    await todo.getByTestId("board-card").first().click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Title + due + description.
    await dialog.getByLabel("Task title").fill("Ship the thing");
    await dialog.getByLabel("Due date").fill("2026-07-20");
    await dialog.getByLabel("Task description").fill("with all the details");

    // Assign a member (solo workspace → just the current user). Members load from the API.
    await dialog.getByRole("button", { name: "Assign members" }).click();
    await dialog.getByTestId("member-option").first().click({ timeout: 15_000 });
    await expect(dialog.getByTestId("assignee-chip")).toHaveCount(1);

    await dialog.getByRole("button", { name: "Close" }).click();
    await page.waitForTimeout(1200); // persist to the replica

    // Persists across reload: reopen the card and check the fields.
    await page.reload();
    const reopened = page.getByTestId("board-col-todo").getByTestId("board-card").first();
    await expect(reopened).toBeVisible({ timeout: 20_000 });
    await reopened.click();
    const dialog2 = page.getByRole("dialog");
    await expect(dialog2.getByLabel("Due date")).toHaveValue("2026-07-20");
    await expect(dialog2.getByLabel("Task description")).toHaveValue("with all the details");
    await expect(dialog2.getByTestId("assignee-chip")).toHaveCount(1);
    await dialog2.getByRole("button", { name: "Close" }).click();

    // Same due date in the Table view.
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByTestId("table");
    await expect(table.locator('input[type="date"]').first()).toHaveValue("2026-07-20");
  });
});
