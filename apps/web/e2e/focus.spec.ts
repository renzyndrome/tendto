import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * Put the timer at a phase boundary without waiting 25 minutes: write the persisted store with an
 * `endsAt` already in the past, then reload so it rehydrates. The completion effect runs when the
 * Focus view mounts and finds the countdown at zero.
 */
async function seedElapsedWorkPhase(page: Page, autoContinue: boolean): Promise<void> {
  await page.evaluate(
    (auto) =>
      localStorage.setItem(
        "tendto-focus",
        JSON.stringify({
          state: {
            phase: "work",
            running: true,
            endsAt: Date.now() - 1000,
            pausedRemaining: 0,
            completed: 0,
            workMin: 25,
            breakMin: 5,
            autoContinue: auto,
            tasks: [],
          },
          version: 0,
        }),
      ),
    autoContinue,
  );
  await page.reload();
  await expect(page.getByTestId("focus-timer")).toBeVisible({ timeout: 30_000 });
}

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

  test("a finished focus session arms the break but does not start it", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "Focus" }).click();
    await seedElapsedWorkPhase(page, false);

    // The session counted, and the break is loaded and waiting.
    await expect(page.getByTestId("focus-completed")).toContainText("1");
    await expect(page.getByTestId("focus-timer")).toHaveText("05:00");
    await expect(page.getByTestId("focus-start")).toHaveText("Start break");

    // Still sitting at 05:00 a beat later — the clock is not running behind the button.
    await page.waitForTimeout(1500);
    await expect(page.getByTestId("focus-timer")).toHaveText("05:00");

    // And it starts on demand.
    await page.getByTestId("focus-start").click();
    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByTestId("focus-timer")).not.toHaveText("05:00");
  });

  test("with Auto on, the break starts by itself", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Focus" }).click();
    await seedElapsedWorkPhase(page, true);

    await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
    await expect(page.getByTestId("focus-timer")).not.toHaveText("05:00");
    await expect(page.getByTestId("focus-auto")).toBeChecked();
  });
});
