import { expect, test } from "./fixtures";
import { makeUser } from "./helpers/data";

/**
 * Comments on pages and cards, with @mentions.
 *
 * Two properties are worth guarding beyond "the text appears": the thread is a SYNCED table (a
 * teammate in their own browser context sees it, which localStorage could never fake), and
 * authorship is enforced — you can edit your own comment and not someone else's. The mention
 * itself does nothing but render, on purpose: no notification, no badge, no feed.
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";

test.describe("comments", () => {
  test("comment on a card, edit it, and delete it", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    const section = page.getByTestId("comment-section");
    await section.getByRole("textbox").fill("ship it after the review");
    await section.getByRole("button", { name: "Comment" }).click();

    const row = page.getByTestId("comment-row");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("ship it after the review");
    await expect(row).toContainText("just now");
    await expect(row).not.toContainText("(edited)");

    // A reload proves it reached the replica rather than living in component state.
    await page.reload();
    await expect(page.getByTestId("comment-row")).toContainText("ship it after the review", {
      timeout: 30_000,
    });

    // Edit in place. "(edited)" comes from an explicit `edited_at` column — deriving it from
    // updated_at vs created_at compares the device's clock with the server's, which both hides
    // quick edits and invents ones that never happened.
    await page.getByTestId("comment-edit").click();
    const editor = page.getByTestId("comment-row").getByRole("textbox");
    await editor.fill("ship it tomorrow");
    await page.getByTestId("comment-row").getByRole("button", { name: "Save" }).click();
    await expect(page.getByTestId("comment-row")).toContainText("ship it tomorrow");
    await expect(page.getByTestId("comment-row")).toContainText("(edited)");

    page.once("dialog", (dialog) => void dialog.accept());
    await page.getByTestId("comment-delete").click();
    await expect(page.getByTestId("comment-row")).toHaveCount(0);
  });

  test("comment on a page", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill("Launch notes");

    const section = page.getByTestId("comment-section");
    await expect(section).toBeVisible();
    await section.getByRole("textbox").fill("the hero copy still needs a pass");
    await section.getByRole("button", { name: "Comment" }).click();

    await expect(page.getByTestId("comment-row")).toContainText("the hero copy still needs a pass");

    await page.reload();
    await expect(page.getByTestId("comment-row")).toContainText(
      "the hero copy still needs a pass",
      { timeout: 30_000 },
    );
  });

  test("Enter sends, Shift+Enter starts a new line", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const box = page.getByTestId("comment-section").getByRole("textbox");

    await box.fill("first line");
    await box.press("Shift+Enter");
    await box.pressSequentially("second line");
    await expect(page.getByTestId("comment-row")).toHaveCount(0); // nothing sent yet

    await box.press("Enter");
    const row = page.getByTestId("comment-row");
    await expect(row).toContainText("first line");
    await expect(row).toContainText("second line");
    await expect(box).toHaveValue(""); // composer resets for the next comment
  });

  test("@ opens the member picker, and Escape closes it without closing the card", async ({
    authedPage: page,
    user,
  }) => {
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    const box = page.getByTestId("comment-section").getByRole("textbox");
    await box.click();
    await box.pressSequentially("@");
    // The roster is fetched from the members API, so give it a beat on a cold cache.
    await expect(page.getByTestId("mention-menu")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByTestId("mention-menu")).toContainText(user.name);

    // The picker portals inside the card, and the card listens for Escape on the document —
    // dismissing the picker must not take the card with it.
    await page.keyboard.press("Escape");
    await expect(page.getByTestId("mention-menu")).toHaveCount(0);
    await expect(page.getByTestId("item-detail")).toBeVisible();

    await page.keyboard.press("Escape"); // now the card closes
    await expect(page.getByTestId("item-detail")).toHaveCount(0);
  });

  test("picking a mention renders a chip, not raw token text", async ({
    authedPage: page,
    user,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const box = page.getByTestId("comment-section").getByRole("textbox");

    await box.click();
    await box.pressSequentially("ping ");
    await box.pressSequentially("@");
    await expect(page.getByTestId("mention-menu")).toBeVisible({ timeout: 15_000 });
    await page.keyboard.press("Enter"); // takes the highlighted candidate
    await box.pressSequentially("about the deadline");
    await page.getByTestId("comment-section").getByRole("button", { name: "Comment" }).click();

    const chip = page.getByTestId("comment-mention");
    await expect(chip).toHaveCount(1);
    await expect(chip).toContainText(user.name);
    // The stored token is an implementation detail; it must never leak into the rendered text.
    await expect(page.getByTestId("comment-row")).not.toContainText("@[");
    await expect(page.getByTestId("comment-row")).toContainText("about the deadline");
    // Mentioning yourself is the "you were mentioned" cue — the only thing a mention ever does.
    await expect(chip).toHaveAttribute("data-you", "true");
  });

  test("a teammate sees the thread, and cannot edit someone else's comment", async ({
    authedPage: page,
    browser,
  }) => {
    // Owner writes a comment on a page that the teammate will be invited to.
    const pageTitle = `thread-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(pageTitle);
    await expect(page.getByRole("button", { name: pageTitle })).toBeVisible();

    const section = page.getByTestId("comment-section");
    await section.getByRole("textbox").fill("owner says hello");
    await section.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByTestId("comment-row")).toContainText("owner says hello");

    // A real second account in its own context — see the note in sharing.spec.ts.
    const teammate = makeUser();
    const theirContext = await browser.newContext();
    const signUp = await theirContext.request.post(`${AUTH}/api/auth/sign-up/email`, {
      data: { email: teammate.email, password: teammate.password, name: teammate.name },
    });
    expect(signUp.ok(), `sign-up failed: ${signUp.status()} ${await signUp.text()}`).toBeTruthy();

    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await page.getByLabel("Invite by email").fill(teammate.email);
    await page.getByRole("button", { name: "Invite" }).click();
    const inviteUrl = (await page.getByTestId("invite-link").locator("code").innerText()).trim();

    const theirPage = await theirContext.newPage();
    await theirPage.goto(inviteUrl);
    await theirPage.getByTestId("accept-invite").click();
    await expect(theirPage.getByRole("button", { name: pageTitle })).toBeVisible({
      timeout: 30_000,
    });
    await theirPage.getByRole("button", { name: pageTitle }).click();

    // The comment synced down: it is a real row, not local state.
    const theirRow = theirPage.getByTestId("comment-row");
    await expect(theirRow).toContainText("owner says hello", { timeout: 30_000 });
    // ...and it is not theirs to edit or delete.
    await expect(theirPage.getByTestId("comment-edit")).toHaveCount(0);
    await expect(theirPage.getByTestId("comment-delete")).toHaveCount(0);

    // They can add their own, and edit that one.
    const theirSection = theirPage.getByTestId("comment-section");
    await theirSection.getByRole("textbox").fill("teammate replies");
    await theirSection.getByRole("button", { name: "Comment" }).click();
    await expect(theirPage.getByTestId("comment-row")).toHaveCount(2);
    await expect(theirPage.getByTestId("comment-edit")).toHaveCount(1);

    // Back on the owner's side: the reply arrives, and the owner may moderate it (delete only —
    // owners can never edit another member's words; sync.py enforces that server-side).
    await expect(page.getByTestId("comment-row")).toHaveCount(2, { timeout: 30_000 });
    const replyRow = page.getByTestId("comment-row").filter({ hasText: "teammate replies" });
    await expect(replyRow.getByTestId("comment-delete")).toHaveCount(1);
    await expect(replyRow.getByTestId("comment-edit")).toHaveCount(0);

    await theirContext.close();
  });

  test("a viewer reads the thread but has no composer", async ({ authedPage: page, browser }) => {
    const pageTitle = `readonly-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(pageTitle);
    await expect(page.getByRole("button", { name: pageTitle })).toBeVisible();

    const section = page.getByTestId("comment-section");
    await section.getByRole("textbox").fill("visible to everyone");
    await section.getByRole("button", { name: "Comment" }).click();
    await expect(page.getByTestId("comment-row")).toContainText("visible to everyone");

    const viewer = makeUser();
    const theirContext = await browser.newContext();
    const signUp = await theirContext.request.post(`${AUTH}/api/auth/sign-up/email`, {
      data: { email: viewer.email, password: viewer.password, name: viewer.name },
    });
    expect(signUp.ok(), `sign-up failed: ${signUp.status()} ${await signUp.text()}`).toBeTruthy();

    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await page.getByLabel("Invite by email").fill(viewer.email);
    await page.getByLabel("Invite role").selectOption("viewer");
    await page.getByRole("button", { name: "Invite" }).click();
    const inviteUrl = (await page.getByTestId("invite-link").locator("code").innerText()).trim();

    const theirPage = await theirContext.newPage();
    await theirPage.goto(inviteUrl);
    await theirPage.getByTestId("accept-invite").click();
    await expect(theirPage.getByRole("button", { name: pageTitle })).toBeVisible({
      timeout: 30_000,
    });
    await theirPage.getByRole("button", { name: pageTitle }).click();

    // Commenting rides the existing write roles: a viewer reads, and that is all.
    await expect(theirPage.getByTestId("comment-row")).toContainText("visible to everyone", {
      timeout: 30_000,
    });
    await expect(theirPage.getByTestId("comment-composer")).toHaveCount(0);

    await theirContext.close();
  });
});
