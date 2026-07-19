import { expect, test } from "./fixtures";

/**
 * Phase 2 — collections as one primitive, many views. Verifies checklist add + complete, and the
 * kanban board drag between status columns — both persisting through the replica across a reload.
 */
test.describe("collections", () => {
  test("checklist: add an item and mark it done (persists)", async ({ authedPage: page }) => {
    const marker = `task-${Date.now().toString(36)}`;

    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "Checklist" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    const title = page.getByTestId("checklist").getByRole("textbox").first();
    await title.fill(marker);
    await title.blur();

    const checkbox = page.getByTestId("checklist").getByRole("checkbox").first();
    await expect(checkbox).not.toBeChecked();
    // Click (not .check(): the checked state updates asynchronously via a DB write + re-render).
    await checkbox.click();
    await expect(checkbox).toBeChecked();

    await page.waitForTimeout(1000);
    await page.reload();
    await page.getByRole("button", { name: "Checklist" }).click();
    await expect(page.getByTestId("checklist").getByRole("checkbox").first()).toBeChecked({
      timeout: 20_000,
    });
    // The title is an <input> — assert its value, not text content.
    await expect(page.getByTestId("checklist").getByRole("textbox").first()).toHaveValue(marker);
  });

  test("board: drag a card from To do to Done (persists)", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "Task board" }).click(); // To do / In progress / Done
    const todo = page.getByTestId("board-col-todo");
    const done = page.getByTestId("board-col-done");
    await todo.getByRole("button", { name: "+ Add card" }).click();
    await expect(todo.getByTestId("board-card")).toHaveCount(1);
    await expect(done.getByTestId("board-card")).toHaveCount(0);

    // The board uses native HTML5 DnD driven by React state (dragstart sets the id, drop moves it);
    // dispatch those events directly — reliable for native DnD in Playwright.
    await todo.getByTestId("board-card").first().dispatchEvent("dragstart");
    await done.dispatchEvent("drop");

    await expect(done.getByTestId("board-card")).toHaveCount(1);
    await expect(todo.getByTestId("board-card")).toHaveCount(0);

    // Persists across reload.
    await page.waitForTimeout(1000);
    await page.reload();
    await expect(page.getByTestId("board-col-done").getByTestId("board-card")).toHaveCount(1, {
      timeout: 20_000,
    });
  });
});
