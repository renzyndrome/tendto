import { expect, test } from "./fixtures";

/**
 * Card fields: an assignee picked from the workspace's members (rather than typed free text),
 * and a due date with an OPTIONAL time.
 */
test.describe("card due date + assignee", () => {
  test("assign a card to yourself from the member picker", async ({ authedPage: page, user }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("item-detail").waitFor();

    // Solo workspace: the picker still offers you, so work can be assigned to yourself.
    const assignee = page.getByLabel("Card assignee");
    await expect(assignee).toBeVisible();
    await expect(assignee.locator("option")).toContainText([/Unassigned/, new RegExp(user.email)]);

    await assignee.selectOption({ label: `${user.email} (you)` });
    await expect(assignee).toHaveValue(user.email);

    // Persisted, not just component state.
    // The dialog is a route, so reloading reopens the same card — no need to click it.
    await page.reload();
    await page.getByTestId("item-detail").waitFor({ timeout: 30_000 });
    await expect(page.getByLabel("Card assignee")).toHaveValue(user.email);
  });

  test("a due date works with no time, and with an optional time", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("item-detail").waitFor();

    // The time field only appears once a date exists — a time with no day is meaningless.
    await expect(page.getByTestId("detail-due-time")).toHaveCount(0);

    await page.getByTestId("detail-due-date").fill("2026-08-04");
    const time = page.getByTestId("detail-due-time");
    await expect(time).toBeVisible();
    await expect(time).toHaveValue("");

    // All-day survives a reload as a plain date. The card re-renders from the reactive query,
    // so seeing the value means the write reached the replica — gate on it before reloading.
    await expect(page.getByTestId("detail-due-date")).toHaveValue("2026-08-04");
    // The dialog is a route, so reloading reopens the same card — no need to click it.
    await page.reload();
    await page.getByTestId("item-detail").waitFor({ timeout: 30_000 });
    await expect(page.getByTestId("detail-due-date")).toHaveValue("2026-08-04");
    await expect(page.getByTestId("detail-due-time")).toHaveValue("");

    // Adding a time keeps the date.
    await page.getByTestId("detail-due-time").fill("14:30");
    await expect(page.getByTestId("detail-due-time")).toHaveValue("14:30");
    // The dialog is a route, so reloading reopens the same card — no need to click it.
    await page.reload();
    await page.getByTestId("item-detail").waitFor({ timeout: 30_000 });
    await expect(page.getByTestId("detail-due-date")).toHaveValue("2026-08-04");
    await expect(page.getByTestId("detail-due-time")).toHaveValue("14:30");
  });

  test("clearing the date clears the time with it", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("item-detail").waitFor();

    await page.getByTestId("detail-due-date").fill("2026-08-04");
    await page.getByTestId("detail-due-time").fill("09:15");
    await page.getByTestId("detail-due-date").fill("");

    await expect(page.getByTestId("detail-due-time")).toHaveCount(0);
    // The dialog is a route, so reloading reopens the same card — no need to click it.
    await page.reload();
    await page.getByTestId("item-detail").waitFor({ timeout: 30_000 });
    await expect(page.getByTestId("detail-due-date")).toHaveValue("");
  });

  test("a dated card still lands on the calendar", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const title = `cal-${Date.now().toString(36)}`;
    await page.getByTestId("detail-title").fill(title);
    await page.getByTestId("detail-title").press("Enter");
    await page.getByTestId("item-detail").waitFor();

    // A timed due date must still bucket onto its DAY in the calendar grid.
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    await page.getByTestId("detail-due-date").fill(key);
    await page.getByTestId("detail-due-time").fill("16:45");
    await page.getByRole("button", { name: "Close card" }).click();
    // The card's chip renders from the reactive query, so it only appears once the due date
    // reached the replica — gate on it before navigating away.
    await expect(page.getByTestId("board-card").first()).toContainText("Due");

    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByTestId(`cal-day-${key}`).getByText(title)).toBeVisible({
      timeout: 30_000,
    });
  });
});
