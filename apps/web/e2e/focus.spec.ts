import { expect, test } from "./fixtures";

/**
 * Solo use — focus mode. A Pomodoro timer plus an in-session task list: add tasks, check them off,
 * start/pause the timer. The list is device-local (persisted), so it survives a reload.
 */
test.describe("focus mode", () => {
  test("add + complete session tasks, run the timer, and persist across reload", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "Focus" }).click();
    await expect(page).toHaveURL(/\/focus/);
    await expect(page.getByTestId("focus-timer")).toHaveText("25:00");

    // Add two session tasks.
    const task = `focus-${Date.now().toString(36)}`;
    const input = page.getByPlaceholder("Add a task for this session…");
    await input.fill(task);
    await input.press("Enter");
    await input.fill("second task");
    await input.press("Enter");
    const list = page.getByTestId("focus-tasks");
    await expect(list.getByText(task)).toBeVisible();
    await expect(list.getByText("second task")).toBeVisible();

    // Check the first one off.
    const firstCheckbox = list.getByRole("checkbox").first();
    await firstCheckbox.click();
    await expect(firstCheckbox).toBeChecked();

    // Run then pause the timer.
    await page.getByRole("button", { name: "Start" }).click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    // The countdown has moved below the starting 25:00.
    await expect(page.getByTestId("focus-timer")).not.toHaveText("25:00");
    await page.getByRole("button", { name: "Pause" }).click();

    // Tasks (and their done state) persist across a reload — it's local session state.
    await page.reload();
    await expect(page.getByTestId("focus-tasks").getByText(task)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByTestId("focus-tasks").getByRole("checkbox").first()).toBeChecked();
  });
});
