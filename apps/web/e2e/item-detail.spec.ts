import { expect, test } from "./fixtures";

/**
 * The card detail dialog — Trello's "click a card" behaviour, deliberately scoped.
 *
 * It carries the title, a RICH description (the field items previously had nowhere to put) and
 * the fields that already existed. It does NOT carry labels, per-card checklists, attachments
 * or an activity feed — those are on docs/planning/03-roadmap.md's guardrail list, and a
 * checklist inside a card would fork the "same data, many views" primitive.
 *
 * The description reuses the page editor's blocks, so it is the same primitive as a page body —
 * which is exactly why the round-trip through the replica is worth guarding.
 */
test.describe("card detail", () => {
  test("opens from the board, is deep-linked, and Escape closes it", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();

    // Adding a card on the board opens its detail straight away (capture stays one flow).
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expect(page).toHaveURL(/\/c\/[0-9a-f-]+\/i\/[0-9a-f-]+$/);
    await page.getByTestId("detail-title").fill("wire the invoice screen");
    await page.getByTestId("detail-title").press("Enter");

    const cardUrl = page.url();
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("item-detail")).toHaveCount(0);
    await expect(page).not.toHaveURL(cardUrl);

    // Clicking the card reopens it...
    await page.getByTestId("board-card").first().click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await expect(page).toHaveURL(cardUrl);

    // ...and the URL alone is enough to open it (linkable, and Back closes it).
    await page.goto("/");
    await page.goto(cardUrl);
    await expect(page.getByTestId("detail-title")).toHaveValue("wire the invoice screen", {
      timeout: 30_000,
    });
    await page.goBack();
    await expect(page.getByTestId("item-detail")).toHaveCount(0);
  });

  test("the description is a text box, not a document surface", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const description = page.getByTestId("detail-description");
    await expect(description).toBeVisible();

    // No block chrome: the drag-handle / add-block gutter is what made this read as a document
    // rather than a field.
    await expect(page.locator(".bn-side-menu")).toHaveCount(0);

    // The formatting bar is PERSISTENT, not revealed by selecting text — in a small field the
    // options should be visible without having to discover them.
    const toolbar = description.locator(".bn-toolbar");
    await expect(toolbar).toBeVisible();
    // Curated, not BlockNote's default set (which adds alignment, colour and nesting).
    await expect(toolbar.locator("button")).toHaveCount(6);

    // Markdown shortcuts still apply...
    await description.locator(".bn-editor").click();
    await page.keyboard.type("## Shoot list");
    await page.keyboard.press("Enter");
    await page.keyboard.type("Bring the **wide lens**.");
    await expect(description.locator('[data-content-type="heading"]')).toHaveCount(1);
    await expect(description.locator("strong")).toHaveText("wide lens");

    // ...and so does clicking the bar. Double-click selects a whole word deterministically.
    await description.locator(".bn-editor").click();
    await page.keyboard.type(" Pack early.");
    await description.getByText("Pack").dblclick();
    await toolbar.locator("button").nth(2).click(); // italic
    await expect(description.locator("em")).toHaveCount(1);
  });

  test("Escape dismisses the editor's menu before closing the card", async ({
    authedPage: page,
  }) => {
    // The slash menu portals outside the dialog, so a naive Escape handler closed the whole
    // card and lost the user's place mid-edit.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await page.getByTestId("detail-description").locator(".bn-editor").click();

    await page.keyboard.type("/");
    await expect(page.locator(".bn-suggestion-menu")).toBeVisible();

    await page.keyboard.press("Escape"); // dismisses the menu only
    await expect(page.locator(".bn-suggestion-menu")).toHaveCount(0);
    await expect(page.getByTestId("item-detail")).toBeVisible();

    await page.keyboard.press("Escape"); // now closes the card
    await expect(page.getByTestId("item-detail")).toHaveCount(0);
  });

  test("a rich description survives a reload", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    const description = page.getByTestId("detail-description");
    await description.locator(".bn-editor").click();
    await page.keyboard.type("Shoot list:");
    await page.keyboard.press("Enter");
    await page.keyboard.type("- lobby at golden hour");
    await page.keyboard.press("Enter");
    await page.keyboard.type("pool deck, wide");

    await expect(description).toContainText("lobby at golden hour");
    // Blocks are debounced into the replica; the reload proves they round-tripped.
    await page.waitForTimeout(1500);
    await page.reload();

    const reloaded = page.getByTestId("detail-description");
    await expect(reloaded).toContainText("Shoot list:", { timeout: 30_000 });
    await expect(reloaded).toContainText("lobby at golden hour");
    await expect(reloaded).toContainText("pool deck, wide");
    // The dash became a real bullet list, i.e. it is blocks and not plain text.
    await expect(reloaded.locator('[data-content-type="bulletListItem"]').first()).toBeVisible();
  });

  test("every edit saves, not just the first", async ({ authedPage: page }) => {
    /*
     * Regression: the upsert was "UPDATE, and INSERT if rowsAffected is 0", but PowerSync's
     * tables are SQLite VIEWS and report rowsAffected: 0 even for an UPDATE that changed a row.
     * So the INSERT always ran — fine the first time, a UNIQUE violation every time after,
     * which rolled the transaction back and silently reverted the edit. Only the FIRST save of
     * any block ever stuck. One-shot tests can't see this; you have to edit twice.
     */
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    const editor = page.getByTestId("detail-description").locator(".bn-editor");
    const reopen = async () => {
      await page.getByTestId("board-card").first().click();
      await expect(page.getByTestId("item-detail")).toBeVisible();
    };

    await editor.click();
    await page.keyboard.type("first");
    await page.keyboard.press("Escape");
    await reopen();
    await expect(page.getByTestId("detail-description")).toContainText("first");

    // Second edit to the SAME block — this is what used to vanish.
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("-second");
    await page.getByRole("button", { name: "Close card" }).click();
    await reopen();
    await expect(page.getByTestId("detail-description")).toContainText("first-second");

    // And a third, to be sure it isn't an off-by-one.
    await editor.click();
    await page.keyboard.press("End");
    await page.keyboard.type("-third");
    await page.getByRole("button", { name: "Close card" }).click();
    await reopen();
    await expect(page.getByTestId("detail-description")).toContainText("first-second-third");
  });

  test("autosaves, and says so", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    // Nothing to report before the user types.
    await expect(page.getByTestId("save-state")).toHaveCSS("opacity", "0");

    await page.getByTestId("detail-description").locator(".bn-editor").click();
    await page.keyboard.type("some notes");

    // Autosave is silent by design, but silence reads as "did that save?".
    await expect(page.getByTestId("save-state")).toHaveText("Saving…");
    await expect(page.getByTestId("save-state")).toHaveText("Saved");
  });

  test("typing is not lost if the page is reloaded immediately", async ({ authedPage: page }) => {
    // Saving to the replica is async (PowerSync worker), so a reload inside the debounce
    // window used to throw the text away — flushing on pagehide can't help, the browser won't
    // wait for a promise. The editor stashes a synchronous localStorage draft on the way out
    // and replays it on mount.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    await page.getByTestId("detail-title").fill("unsaved title");
    await page.getByTestId("detail-description").locator(".bn-editor").click();
    await page.keyboard.type("unsaved body");
    await page.reload(); // no pause at all

    await expect(page.getByTestId("item-detail")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByTestId("detail-description")).toContainText("unsaved body", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("detail-title")).toHaveValue("unsaved title");

    // The recovered draft must be written through, not just shown — a second reload proves it
    // reached the replica, and no draft should be left behind.
    await page.reload();
    await expect(page.getByTestId("detail-description")).toContainText("unsaved body", {
      timeout: 30_000,
    });
    await expect(page.getByTestId("detail-title")).toHaveValue("unsaved title");
    // Drafts are transient by design: leaving the page writes one, and it is dropped once the
    // replay reaches the replica. So assert it is cleaned up EVENTUALLY rather than at an
    // arbitrary instant — otherwise this races the reload that just happened.
    await expect
      .poll(
        () =>
          page.evaluate(
            () => Object.keys(localStorage).filter((key) => key.startsWith("tendto:draft")).length,
          ),
        { timeout: 15_000, message: "expected recovered drafts to be cleaned up" },
      )
      .toBe(0);
  });

  test("editing two fields back to back keeps both", async ({ authedPage: page, user }) => {
    // Properties are one JSON bag, so every field edit is a read-modify-write. These fire
    // without awaiting each other; if the read isn't inside the write transaction, the second
    // patch merges onto a stale bag and silently drops the first field. This exact sequence
    // used to lose the title.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    await page.getByTestId("detail-title").fill("keep me");
    await page.getByTestId("detail-title").press("Enter"); // commits on blur
    await page.getByTestId("detail-due-date").fill("2026-08-09"); // immediately after
    await page.getByLabel("Card assignee").selectOption(user.email);

    await page.getByRole("button", { name: "Close card" }).click();
    const card = page.getByTestId("board-card").first();
    await expect(card).toContainText("keep me");
    await expect(card).toContainText("Due Aug 9");
    await expect(card).toContainText(user.email);
  });

  test("each card has its own description", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();

    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await page.getByTestId("detail-title").fill("first card");
    await page.getByTestId("detail-title").press("Enter");
    await page.getByTestId("detail-description").locator(".bn-editor").click();
    await page.keyboard.type("belongs to the first card");
    await page.waitForTimeout(1200);
    await page.getByRole("button", { name: "Close card" }).click();

    await page.getByTestId("board-col-todo").getByRole("button", { name: "+ Add card" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    // A fresh card must not inherit the previous one's body.
    await expect(page.getByTestId("detail-description")).not.toContainText("first card");
  });

  test("deleting a card from the detail removes it from the board", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await page.getByTestId("detail-title").fill("throwaway");
    await page.getByTestId("detail-title").press("Enter");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByRole("button", { name: "Delete card" }).click();

    await expect(page.getByTestId("item-detail")).toHaveCount(0);
    await expect(page.getByTestId("board-card")).toHaveCount(0);
  });

  test("the detail carries no labels, checklists, attachments or activity feed", async ({
    authedPage: page,
  }) => {
    // A guard on scope, not on styling: these are the parts of Trello's card that
    // docs/planning/03-roadmap.md rules out. If one appears, it should be a deliberate choice.
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    const detail = page.getByTestId("item-detail");
    await expect(detail).toBeVisible();

    // "Activity" is the ruled-out half of Trello's "Comments and activity": a log of what other
    // people did. A comment thread is people talking, and it shipped deliberately.
    for (const absent of ["Labels", "Attachments", "Add an item", "Activity"]) {
      await expect(detail.getByText(absent, { exact: false })).toHaveCount(0);
    }
    // The fields that DO belong are all present.
    await expect(detail.getByLabel("Card status")).toBeVisible();
    await expect(detail.getByTestId("detail-due-date")).toBeVisible();
    await expect(detail.getByLabel("Card assignee")).toBeVisible();
    await expect(detail.getByTestId("detail-description")).toBeVisible();
    await expect(detail.getByTestId("comment-section")).toBeVisible();
  });
});
