import { expect, test } from "./fixtures";

/**
 * How a board card READS, now that it is a summary rather than a form: clicking it opens the
 * detail dialog (Trello-style), so the card itself only has to show the title and the facts
 * you'd want at a glance. A long title wraps instead of scrolling out of view.
 */
const LONG_TITLE = "update the west laguna website with actual photos from the shoot";

/** Add a card (which opens its detail), give it a title, and return to the board. */
async function addCard(page: import("@playwright/test").Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "+ New item" }).click();
  await page.getByTestId("item-detail").waitFor();
  await page.getByTestId("detail-title").fill(title);
  await page.getByTestId("detail-title").press("Enter");
  await page.getByRole("button", { name: "Close card" }).click();
}

test.describe("board card presentation", () => {
  test("a long title wraps instead of being cut off", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await addCard(page, LONG_TITLE);

    const card = page.getByTestId("board-card").first();
    await expect(card).toContainText(LONG_TITLE);

    // Nothing is clipped horizontally, and the title occupies more than one line.
    const box = await card.evaluate((el: HTMLElement) => ({
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      height: el.getBoundingClientRect().height,
    }));
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.height).toBeGreaterThan(40);
  });

  test("the title stays one line: Enter commits, pasted newlines collapse", async ({
    authedPage: page,
  }) => {
    // Wrapping is presentation only — the value must never gain a line break, or it would
    // round-trip into table cells, list rows, calendar chips and exports.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("item-detail").waitFor();

    const title = page.getByTestId("detail-title");
    await title.fill("first line");
    await title.press("Enter");
    await expect(title).toHaveValue("first line");
    await expect(title).not.toBeFocused(); // Enter blurred (committed), no newline inserted

    await title.fill("line one\nline two\n\nline three");
    await expect(title).toHaveValue("line one line two line three");
  });

  test("a card shows its due date and assignee without opening", async ({
    authedPage: page,
    user,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("item-detail").waitFor();
    await page.getByTestId("detail-title").fill("book the venue");
    await page.getByTestId("detail-title").press("Enter");
    await page.getByTestId("detail-due-date").fill("2026-08-06");
    await page.getByTestId("detail-due-time").fill("09:30");
    await page.getByLabel("Card assignee").selectOption(user.email);
    await page.getByRole("button", { name: "Close card" }).click();

    const card = page.getByTestId("board-card").first();
    await expect(card).toContainText("Due Aug 6, 09:30");
    await expect(card).toContainText(user.email);
  });

  test("a card with nothing set stays compact", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await addCard(page, "bare card");

    await expect(page.getByTestId("board-card").first()).not.toContainText("Due");
  });
});
