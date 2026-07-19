import { expect, test } from "./fixtures";

/** Local YYYY-MM-DD (matches the app's toDateKey, which is local — not UTC). */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Phase 3 — unified calendar. An item given a due date (today) shows up as a chip on that day in
 * the month grid, and clicking it opens its collection.
 */
test.describe("calendar", () => {
  test("a due-dated item appears on the calendar and links to its collection", async ({
    authedPage: page,
  }) => {
    const marker = `due-${Date.now().toString(36)}`;
    const date = todayKey();

    // Create an item with a title + a due date via the table view.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "Task board" }).click();
    await page.getByRole("button", { name: "Table" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const table = page.getByTestId("table");
    await table.getByPlaceholder("Untitled").first().fill(marker);
    await table.getByPlaceholder("Untitled").first().blur();
    await table.locator('input[type="date"]').first().fill(date);
    await page.waitForTimeout(1000); // persist to the replica

    // The unified calendar shows it on today's cell.
    await page.getByRole("button", { name: "Calendar" }).click();
    const todayCell = page.getByTestId(`cal-day-${date}`);
    await expect(todayCell.getByText(marker)).toBeVisible({ timeout: 20_000 });

    // Clicking the chip opens its collection.
    await todayCell.getByText(marker).click();
    await expect(page).toHaveURL(/\/c\//);
  });
});
