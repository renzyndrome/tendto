import { expect, test } from "./fixtures";

/** Local YYYY-MM-DD (matches the app's toDateKey, which is local — not UTC). */
function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * The grid is 24 hours tall at 56px an hour, so a y offset inside it maps to a time. Kept in one
 * place: if HOUR_HEIGHT ever changes, this is the single line to follow.
 */
const PX_PER_MINUTE = 56 / 60;
function yForTime(hour: number, minute = 0): number {
  return (hour * 60 + minute) * PX_PER_MINUTE;
}

/**
 * Day view — the Google-Calendar-style time grid. Covers the three things that make it useful:
 * getting there from the month grid, plotting a task on a slot, and moving one to another time.
 */
test.describe("calendar day view", () => {
  test("clicking a day opens it, and a task can be plotted on a time slot", async ({
    authedPage: page,
  }) => {
    const marker = `plot-${Date.now().toString(36)}`;
    const date = todayKey();

    // A collection to hold the task — an item always belongs to one. Wait for its route: the
    // creation navigates, and clicking away before it lands means it navigates back over us.
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Calendar" }).click();

    // Clicking the day cell drills into the day view.
    await page.getByTestId(`cal-day-${date}`).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${date}$`));

    const grid = page.getByTestId("day-grid");
    await expect(grid).toBeVisible();

    // Click the 09:00 slot: the quick-create bubble opens pre-filled with that time.
    await grid.click({ position: { x: 120, y: yForTime(9) } });
    await expect(page.getByTestId("quick-create-time")).toHaveValue("09:00");

    // One collection means there is no choice to make, so the picker stays out of the way.
    await expect(page.getByTestId("quick-create-collection")).toHaveCount(0);
    // Likewise a lone workspace: a badge on every task saying the same thing tells you nothing.
    await expect(page.getByTestId("day-workspace-badge")).toHaveCount(0);

    await page.getByTestId("quick-create-title").fill(marker);
    await page.getByRole("button", { name: "Save" }).click();

    // It is plotted on the grid at that time...
    const block = grid.getByTestId(/^day-item-/).filter({ hasText: marker });
    await expect(block).toBeVisible();
    await expect(block).toContainText("09:00");

    // ...and it really landed in the replica, not just in local state.
    await page.reload();
    await expect(grid.getByTestId(/^day-item-/).filter({ hasText: marker })).toContainText("09:00");
  });

  test("dragging a task to another slot reschedules it", async ({ authedPage: page }) => {
    const marker = `drag-${Date.now().toString(36)}`;
    const date = todayKey();

    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Calendar" }).click();
    await page.getByTestId(`cal-day-${date}`).click();

    const grid = page.getByTestId("day-grid");
    await grid.click({ position: { x: 120, y: yForTime(9) } });
    await page.getByTestId("quick-create-title").fill(marker);
    await page.getByRole("button", { name: "Save" }).click();

    const block = grid.getByTestId(/^day-item-/).filter({ hasText: marker });
    await expect(block).toContainText("09:00");

    // Drop it so the block's TOP lands on 13:00 — the drag keeps the grip offset, and the block
    // is half a slot tall, so the pointer sits half a block below where the block starts.
    const half = (30 * PX_PER_MINUTE - 2) / 2;
    await block.dragTo(grid, { targetPosition: { x: 120, y: yForTime(13) + half } });

    await expect(block).toContainText("13:00");

    // Dropping it on the all-day row clears the time entirely.
    await block.dragTo(page.getByTestId("day-all-day"));
    await expect(page.getByTestId("day-all-day").getByText(marker)).toBeVisible();
  });

  test("with more than one collection, the picker appears and is honoured", async ({
    authedPage: page,
  }) => {
    const marker = `pick-${Date.now().toString(36)}`;
    const date = todayKey();

    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    const first = new URL(page.url()).pathname.split("/")[2];

    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).not.toHaveURL(new RegExp(first));

    await page.getByRole("button", { name: "Calendar" }).click();
    await page.getByTestId(`cal-day-${date}`).click();

    const grid = page.getByTestId("day-grid");
    await grid.click({ position: { x: 120, y: yForTime(9) } });

    // Now there is a real choice — send it to the FIRST collection, not the default.
    await page.getByTestId("quick-create-collection").selectOption(first);
    await page.getByTestId("quick-create-title").fill(marker);
    await page.getByRole("button", { name: "Save" }).click();

    await grid.getByTestId(/^day-item-/).filter({ hasText: marker }).click();
    await expect(page).toHaveURL(new RegExp(`/c/${first}/i/`));
  });

  test("tasks from every workspace share the calendar, badged with where they came from", async ({
    authedPage: page,
  }) => {
    const date = todayKey();
    const first = `wsA-${Date.now().toString(36)}`;
    const second = `wsB-${Date.now().toString(36)}`;

    // A task in the bootstrapped workspace...
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Calendar" }).click();
    await page.getByTestId(`cal-day-${date}`).click();
    const grid = page.getByTestId("day-grid");
    await grid.click({ position: { x: 120, y: yForTime(9) } });
    await page.getByTestId("quick-create-title").fill(first);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(grid.getByTestId(/^day-item-/).filter({ hasText: first })).toBeVisible();

    // ...and a task in a second workspace.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "+ New workspace" }).click();
    const nameInput = page.getByLabel("New workspace name");
    await nameInput.fill("Second Workspace");
    await nameInput.press("Enter");
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Second Workspace",
      { timeout: 30_000 },
    );
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Calendar" }).click();
    // By now today's cell holds the first task's chip, so click the date number, not the cell.
    await page.getByTestId(`cal-day-${date}`).getByRole("button", { name: `Open ${date}` }).click();
    await grid.click({ position: { x: 120, y: yForTime(14) } });
    await page.getByTestId("quick-create-title").fill(second);
    await page.getByRole("button", { name: "Save" }).click();

    // Both are on the same day, each saying where it came from.
    const blockA = grid.getByTestId(/^day-item-/).filter({ hasText: first });
    const blockB = grid.getByTestId(/^day-item-/).filter({ hasText: second });
    await expect(blockA).toBeVisible({ timeout: 20_000 });
    await expect(blockA.getByTestId("day-workspace-badge")).toHaveText("My Workspace");
    await expect(blockB.getByTestId("day-workspace-badge")).toHaveText("Second Workspace");

    // Opening one from another workspace follows it there, rather than leaving the sidebar behind.
    await blockA.click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "My Workspace",
    );

    // The month grid badges them too.
    await page.getByRole("button", { name: "Close card" }).click();
    await page.getByRole("button", { name: "Calendar" }).click();
    // Generous: these rows come from another workspace's bucket, and a sync-rules change makes
    // PowerSync reprocess every bucket, which can slow the first sync-down right after a deploy.
    const cell = page.getByTestId(`cal-day-${date}`);
    await expect(cell.getByText(first)).toBeVisible({ timeout: 30_000 });
    await expect(cell.getByText(second)).toBeVisible({ timeout: 30_000 });
    await expect(cell.getByTestId("cal-workspace-badge").first()).toBeVisible();
  });

  test("a task with no time sits in the all-day row and opens its card", async ({
    authedPage: page,
  }) => {
    const marker = `allday-${Date.now().toString(36)}`;
    const date = todayKey();

    // Create it with a date but no time, via the table view's due picker.
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Table" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const table = page.getByTestId("table");
    await table.getByPlaceholder("Untitled").first().fill(marker);
    await table.getByPlaceholder("Untitled").first().blur();
    await table.locator('input[type="date"]').first().fill(date);

    await page.getByRole("button", { name: "Calendar" }).click();
    const cell = page.getByTestId(`cal-day-${date}`);
    await expect(cell.getByText(marker)).toBeVisible({ timeout: 20_000 });

    // The chip opens the card itself; the cell behind it opens the day.
    await cell.getByText(marker).click();
    await expect(page).toHaveURL(/\/c\/[^/]+\/i\//);

    // The date number is the unambiguous way in — the middle of a busy cell is a chip.
    await page.goBack();
    await cell.getByRole("button", { name: `Open ${date}` }).click();
    await expect(page.getByTestId("day-all-day").getByText(marker)).toBeVisible();
  });
});
