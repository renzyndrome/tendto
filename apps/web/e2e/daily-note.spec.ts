import type { Locator, Page } from "@playwright/test";

import { expect, test } from "./fixtures";

/**
 * Daily notes: one page per local day, opened from the sidebar (today) or from the calendar's
 * day view (that day), created on first open and kept in a single "Daily notes" folder.
 */

/** Local YYYY-MM-DD, like the app's toDateKey (never UTC). */
function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate(),
  ).padStart(2, "0")}`;
}

/** The note's title as the BROWSER writes it, so the test follows whatever locale it runs in. */
async function longDate(page: Page, key: string): Promise<string> {
  return page.evaluate(
    (k) =>
      new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, Number(k.slice(8, 10)))
        .toLocaleDateString(undefined, {
          weekday: "long",
          year: "numeric",
          month: "long",
          day: "numeric",
        }),
    key,
  );
}

/** Folder rows in the Pages tree named "Daily notes". */
function folderRows(page: Page): Locator {
  return page.getByTestId("tree-row").filter({
    has: page.getByRole("button", { name: "Daily notes", exact: true }),
  });
}

/** The "Daily notes" folder's node: its row plus everything inside it. */
function folderNode(page: Page): Locator {
  return page.getByTestId("tree-node").filter({ has: folderRows(page) }).last();
}

/** The sidebar's entry, not the day view's button of the same name. */
function sidebarDailyNote(page: Page): Locator {
  return page.locator("aside").getByRole("button", { name: "Daily note", exact: true });
}

test.describe("daily note", () => {
  test("the sidebar opens today's note inside a Daily notes folder, and the same one again", async ({
    authedPage: page,
  }) => {
    const today = await longDate(page, dateKey(new Date()));

    await sidebarDailyNote(page).click();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByTestId("page-title")).toHaveValue(today, { timeout: 20_000 });
    const noteUrl = page.url();
    // The date was named by the app, not by a person: a blank note offers no comment box yet.
    await page.waitForTimeout(1000);
    await expect(page.getByTestId("comment-section")).toHaveCount(0);

    await expect(folderRows(page)).toHaveCount(1);
    await expect(folderRows(page)).toHaveAttribute("data-kind", "folder");
    await expect(
      folderNode(page).getByRole("button", { name: today, exact: true }),
    ).toBeVisible();

    // Away and back: the same page, not a second one, and still one folder.
    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await expect(page).toHaveURL(/\/calendar/);
    await sidebarDailyNote(page).click();
    await expect(page).toHaveURL(noteUrl);
    await expect(page.getByTestId("page-title")).toHaveValue(today);
    await expect(folderRows(page)).toHaveCount(1);
    await expect(folderNode(page).getByRole("button", { name: today, exact: true })).toHaveCount(
      1,
    );
  });

  test("the day view opens that day's note, once, in the same folder", async ({
    authedPage: page,
  }) => {
    const now = new Date();
    const tomorrowDate = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const today = await longDate(page, dateKey(now));
    const tomorrow = await longDate(page, dateKey(tomorrowDate));

    // Today's note first, so the day view has a folder to file into.
    await sidebarDailyNote(page).click();
    await expect(page.getByTestId("page-title")).toHaveValue(today, { timeout: 20_000 });

    await page.getByRole("button", { name: "Calendar", exact: true }).click();
    await page.getByTestId(`cal-day-${dateKey(now)}`).click();
    await page.getByRole("button", { name: "Next day" }).click();
    await expect(page).toHaveURL(new RegExp(`/calendar/${dateKey(tomorrowDate)}$`));

    // A double click races two opens; the second must find the first one's page.
    await page.getByTestId("day-daily-note").dblclick();
    await expect(page).toHaveURL(/\/p\//);
    await expect(page.getByTestId("page-title")).toHaveValue(tomorrow, { timeout: 20_000 });

    await page.waitForTimeout(500); // room for a duplicate to show, were one made
    await expect(folderRows(page)).toHaveCount(1);
    const folder = folderNode(page);
    await expect(folder.getByRole("button", { name: tomorrow, exact: true })).toHaveCount(1);
    await expect(folder.getByRole("button", { name: today, exact: true })).toHaveCount(1);
  });
});
