import { expect, test } from "./fixtures";

/**
 * Card fields: an assignee picked from the workspace's members (rather than typed free text),
 * and a due date with an OPTIONAL time.
 */
test.describe("card due date + assignee", () => {
  test("assign a card to yourself from the member picker", async ({ authedPage: page, user }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByRole("button", { name: "Edit card details" }).first().click();

    // Solo workspace: the picker still offers you, so work can be assigned to yourself.
    const assignee = page.getByLabel("Card assignee");
    await expect(assignee).toBeVisible();
    await expect(assignee.locator("option")).toContainText([/Unassigned/, new RegExp(user.email)]);

    await assignee.selectOption({ label: `${user.email} (you)` });
    await expect(assignee).toHaveValue(user.email);

    // Persisted, not just component state.
    await page.reload();
    await page.getByRole("button", { name: "Edit card details" }).first().click({ timeout: 30_000 });
    await expect(page.getByLabel("Card assignee")).toHaveValue(user.email);
  });

  test("a due date works with no time, and with an optional time", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByRole("button", { name: "Edit card details" }).first().click();

    // The time field only appears once a date exists — a time with no day is meaningless.
    await expect(page.getByTestId("card-due-time")).toHaveCount(0);

    await page.getByTestId("card-due-date").fill("2026-08-04");
    const time = page.getByTestId("card-due-time");
    await expect(time).toBeVisible();
    await expect(time).toHaveValue("");

    // All-day survives a reload as a plain date. The card re-renders from the reactive query,
    // so seeing the value means the write reached the replica — gate on it before reloading.
    await expect(page.getByTestId("card-due-date")).toHaveValue("2026-08-04");
    await page.reload();
    await page.getByRole("button", { name: "Edit card details" }).first().click({ timeout: 30_000 });
    await expect(page.getByTestId("card-due-date")).toHaveValue("2026-08-04");
    await expect(page.getByTestId("card-due-time")).toHaveValue("");

    // Adding a time keeps the date.
    await page.getByTestId("card-due-time").fill("14:30");
    await expect(page.getByTestId("card-due-time")).toHaveValue("14:30");
    await page.reload();
    await page.getByRole("button", { name: "Edit card details" }).first().click({ timeout: 30_000 });
    await expect(page.getByTestId("card-due-date")).toHaveValue("2026-08-04");
    await expect(page.getByTestId("card-due-time")).toHaveValue("14:30");
  });

  test("clearing the date clears the time with it", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByRole("button", { name: "Edit card details" }).first().click();

    await page.getByTestId("card-due-date").fill("2026-08-04");
    await page.getByTestId("card-due-time").fill("09:15");
    await page.getByTestId("card-due-date").fill("");

    await expect(page.getByTestId("card-due-time")).toHaveCount(0);
    await page.reload();
    await page.getByRole("button", { name: "Edit card details" }).first().click({ timeout: 30_000 });
    await expect(page.getByTestId("card-due-date")).toHaveValue("");
  });

  test("a dated card still lands on the calendar", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const title = `cal-${Date.now().toString(36)}`;
    await page.getByTestId("board-card").first().getByRole("textbox").first().fill(title);
    await page.getByTestId("board-card").first().getByRole("textbox").first().press("Enter");
    await page.getByRole("button", { name: "Edit card details" }).first().click();

    // A timed due date must still bucket onto its DAY in the calendar grid.
    const today = new Date();
    const key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(
      today.getDate(),
    ).padStart(2, "0")}`;
    await page.getByTestId("card-due-date").fill(key);
    await page.getByTestId("card-due-time").fill("16:45");

    await page.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByTestId(`cal-day-${key}`).getByText(title)).toBeVisible({
      timeout: 30_000,
    });
  });
});
