import { expect, test } from "./fixtures";

/**
 * How a board card READS. Cards are narrow, so a long title in a single-line input scrolled
 * sideways and showed only the fragment around the caret — the card looked like it held
 * truncated nonsense. The title now wraps; the value is still one line of text.
 */
const LONG_TITLE = "update the west laguna website with actual photos from the shoot";

test.describe("board card presentation", () => {
  test("a long title wraps instead of scrolling out of view", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    const title = page.getByTestId("board-card").first().getByLabel("Card title");
    await title.fill(LONG_TITLE);
    await title.press("Enter");

    await expect(title).toHaveValue(LONG_TITLE);

    // Nothing is clipped: the field grew to fit its content rather than hiding the overflow,
    // and it is taller than a single line.
    const box = await title.evaluate((el: HTMLTextAreaElement) => ({
      scrollHeight: el.scrollHeight,
      clientHeight: el.clientHeight,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      lineHeight: parseFloat(getComputedStyle(el).lineHeight),
    }));
    expect(box.scrollHeight).toBeLessThanOrEqual(box.clientHeight + 1);
    expect(box.scrollWidth).toBeLessThanOrEqual(box.clientWidth + 1);
    expect(box.clientHeight).toBeGreaterThan(box.lineHeight * 1.5);
  });

  test("the title stays one line: Enter commits, pasted newlines collapse", async ({
    authedPage: page,
  }) => {
    // Wrapping is presentation only — the value itself must never gain a line break, or it
    // would round-trip into every other view (table cell, list row, calendar chip, export).
    // Persistence of the title is covered by board-card-edit / page-title specs.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    const title = page.getByTestId("board-card").first().getByLabel("Card title");

    await title.fill("first line");
    await title.press("Enter");
    await expect(title).toHaveValue("first line");
    await expect(title).not.toBeFocused(); // Enter blurred (committed) instead of inserting \n

    // A multi-line paste becomes a single line rather than smuggling newlines in.
    await title.fill("line one\nline two\n\nline three");
    await expect(title).toHaveValue("line one line two line three");
  });

  test("a collapsed card shows its due date and assignee", async ({ authedPage: page, user }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    const card = page.getByTestId("board-card").first();
    await card.getByLabel("Card title").fill("book the venue");
    await card.getByLabel("Card title").press("Enter");

    await page.getByRole("button", { name: "Edit card details" }).click();
    await page.getByTestId("card-due-date").fill("2026-08-06");
    await page.getByTestId("card-due-time").fill("09:30");
    await page.getByLabel("Card assignee").selectOption(user.email);
    await page.getByRole("button", { name: "Hide card details" }).click();

    // Readable without expanding the card.
    await expect(card).toContainText("Due Aug 6, 09:30");
    await expect(card).toContainText(user.email);
  });

  test("a card with nothing set stays compact", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    const card = page.getByTestId("board-card").first();
    await expect(card).not.toContainText("Due");
  });
});
