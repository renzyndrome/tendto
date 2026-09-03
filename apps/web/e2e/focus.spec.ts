import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";

const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
const API = process.env.VITE_API_URL ?? "http://localhost:18000";

/**
 * Seed focus history straight through the real upload path, then let it sync back down.
 *
 * Going through `POST /sync/upload` rather than poking the replica is deliberate: it exercises
 * the user-owned authorization branch AND proves the new `user_private` bucket delivers the rows
 * to this device — which is the half that would otherwise silently not work.
 */
async function seedFocusHistory(
  page: Page,
  sessions: Array<{ dateKey: string; hour: number; minutes: number }>,
): Promise<void> {
  const tokenRes = await page.request.get(`${AUTH}/api/auth/token`);
  expect(tokenRes.ok(), "could not mint a JWT for seeding").toBeTruthy();
  const { token } = (await tokenRes.json()) as { token: string };

  const entries = sessions.map(({ dateKey, hour, minutes }) => ({
    op: "PUT",
    table: "focus_sessions",
    id: crypto.randomUUID(),
    data: {
      started_at: `${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`,
      local_date: dateKey,
      minutes,
      updated_at: `${dateKey}T${String(hour).padStart(2, "0")}:00:00Z`,
    },
  }));

  const res = await page.request.post(`${API}/sync/upload`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { entries },
  });
  expect(res.ok(), `seeding failed: ${res.status()} ${await res.text()}`).toBeTruthy();
}

/** `YYYY-MM-DD` `delta` days from today, local. */
function dayKey(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

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

  test("a finished session is recorded and survives a reload", async ({ authedPage: page }) => {
    /*
     * Pin the date to midday before anything is seeded.
     *
     * A session files under the day it STARTED (`local_date = toDateKey(startedAt)` in
     * lib/focus/sessions.ts), and the phase seeded below started 25 minutes ago. Run for real
     * in the first 25 minutes after midnight, that start lands on YESTERDAY while the "Today"
     * stat reads today, so this test failed nightly for a reason the app is right about.
     * `setFixedTime` freezes Date.now() only — timers still run, so the app behaves normally.
     */
    const midday = new Date();
    midday.setHours(12, 0, 0, 0);
    await page.clock.setFixedTime(midday);

    await page.getByRole("button", { name: "Focus" }).click();
    // Nothing to show before the first session — and no fake zeroes either.
    await expect(page.getByTestId("focus-stats")).toContainText("your garden starts here");

    await seedElapsedWorkPhase(page, false);

    // The session was recorded by finishing the phase, not by any explicit save.
    await expect(page.getByTestId("stat-today")).toContainText("25m", { timeout: 20_000 });
    await expect(page.getByTestId("stat-days")).toContainText("1/7 days");

    // It reached Postgres and came back: a reload rebuilds this from the replica, and the
    // localStorage timer state carries no history at all.
    await page.reload();
    await expect(page.getByTestId("stat-today")).toContainText("25m", { timeout: 30_000 });
  });

  test("history syncs down and drives the garden, heatmap and bests", async ({
    authedPage: page,
  }) => {
    await seedFocusHistory(page, [
      { dateKey: dayKey(0), hour: 9, minutes: 50 },
      { dateKey: dayKey(0), hour: 14, minutes: 25 },
      { dateKey: dayKey(-1), hour: 10, minutes: 120 },
      { dateKey: dayKey(-2), hour: 21, minutes: 25 },
      { dateKey: dayKey(-30), hour: 11, minutes: 25 },
    ]);

    await page.getByRole("button", { name: "Focus" }).click();

    // Rows the client never wrote locally are here — so the user_private bucket delivered them.
    await expect(page.getByTestId("stat-today")).toContainText("1h 15m", { timeout: 30_000 });

    // Personal bests span the whole history, including the day a month back. Both of these are
    // weekday-independent; "best week" is not, so it is deliberately not asserted exactly.
    const stats = page.getByTestId("focus-stats");
    await expect(stats).toContainText("2h"); // best day = the 120m session
    await expect(stats).toContainText("Most sessions"); // today's two, the busiest day
    await expect(stats.getByText("2", { exact: true }).first()).toBeVisible();

    // The garden grows with the day's TOTAL minutes: today's 50 + 25 = 75 reaches stage 3.
    // Selected by label rather than index so it doesn't depend on which weekday it is.
    const todayPlant = page.getByTestId("focus-garden").locator(`svg[aria-label^="${dayKey(0)}"]`);
    await expect(todayPlant).toHaveAttribute("data-stage", "3");

    // 12 weeks of squares, and the peak-hours histogram rendered.
    await expect(page.getByTestId("focus-heatmap").locator("span")).toHaveCount(12 * 7);
    await expect(page.getByTestId("focus-peak-hours")).toBeVisible();
  });
});
