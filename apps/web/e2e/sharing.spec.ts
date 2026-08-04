import { expect, test } from "./fixtures";
import { makeUser } from "./helpers/data";

/**
 * Workspace settings + sharing: rename, invite a real second account, accept the invitation in
 * a separate browser context, and confirm the invited user actually receives the workspace's
 * content through the sync stream. Also covers the tenancy guard on the invite link itself.
 *
 * No email provider is configured in dev, so the API returns the invite URL and the UI shows a
 * copyable link — that link is what the second context navigates to.
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";

test.describe("workspace settings", () => {
  test("rename a workspace from settings", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();

    const nameInput = page.getByLabel("Workspace name");
    await expect(nameInput).toHaveValue("My Workspace");
    await nameInput.fill("Renamed Workspace");
    await nameInput.press("Enter");

    await page.getByRole("button", { name: "Close settings" }).click();
    // Rename is a local write, so the switcher reflects it immediately.
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Renamed Workspace",
    );

    // And it survives a reload, which proves it persisted (and synced) rather than being
    // component state.
    await page.reload();
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Renamed Workspace",
      { timeout: 30_000 },
    );
  });

  test("owner sees themselves as the only member", async ({ authedPage: page, user }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();

    const members = page.getByTestId("member-list");
    await expect(members.getByText(user.email)).toBeVisible();
    await expect(members.getByText("(you)")).toBeVisible();
  });

  test("cannot delete your only workspace", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();

    await expect(page.getByText("This is your only workspace.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete" })).toHaveCount(0);
  });

  test("delete a second workspace after typing its name", async ({ authedPage: page }) => {
    // Make a second workspace so deletion is permitted.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "+ New workspace" }).click();
    await page.getByLabel("New workspace name").fill("Disposable");
    await page.getByLabel("New workspace name").press("Enter");
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Disposable",
      { timeout: 30_000 },
    );

    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();

    const deleteButton = page.getByRole("button", { name: "Delete" });
    // Guard: the button stays disabled until the name matches exactly.
    await expect(deleteButton).toBeDisabled();
    await page.getByLabel(/Type .* to confirm/).fill("Disposabl");
    await expect(deleteButton).toBeDisabled();
    await page.getByLabel(/Type .* to confirm/).fill("Disposable");
    await expect(deleteButton).toBeEnabled();
    await deleteButton.click();

    // Falls back to the remaining workspace.
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "My Workspace",
      { timeout: 30_000 },
    );
  });
});

test.describe("sharing", () => {
  test("invite a teammate, accept, and see the shared content", async ({
    authedPage: page,
    browser,
  }) => {
    // Owner creates a page so there is something to share.
    const shared = `shared-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(shared);
    await expect(page.getByRole("button", { name: shared })).toBeVisible();

    // A real second account, created in ITS OWN context. `page.request` carries the owner's
    // session cookie, and better-auth refuses to sign a new user up on an authenticated
    // request — so the teammate's context both registers them and holds their session.
    const teammate = makeUser();
    const theirContext = await browser.newContext();
    const signUp = await theirContext.request.post(`${AUTH}/api/auth/sign-up/email`, {
      data: { email: teammate.email, password: teammate.password, name: teammate.name },
    });
    expect(signUp.ok(), `sign-up failed: ${signUp.status()} ${await signUp.text()}`).toBeTruthy();

    // Owner invites them.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await page.getByLabel("Invite by email").fill(teammate.email);
    await page.getByRole("button", { name: "Invite" }).click();

    // With no email provider configured, the UI surfaces the link instead of silently failing.
    const linkBox = page.getByTestId("invite-link");
    await expect(linkBox).toBeVisible();
    const inviteUrl = (await linkBox.locator("code").innerText()).trim();
    expect(inviteUrl).toContain("/invite/");

    // The invitation shows as pending for the owner.
    await expect(page.getByTestId("pending-invites").getByText(teammate.email)).toBeVisible();

    // The teammate accepts in their own browser context (own session, own replica).
    const theirPage = await theirContext.newPage();
    await theirPage.goto(inviteUrl);
    await theirPage.getByTestId("accept-invite").click();

    // They land in the shared workspace and the owner's page syncs down to them.
    await expect(theirPage.getByRole("button", { name: "Switch workspace" })).toContainText(
      "My Workspace",
      { timeout: 30_000 },
    );
    await expect(theirPage.getByRole("button", { name: shared })).toBeVisible({
      timeout: 30_000,
    });

    // Back on the owner's side, the pending invite has become a member.
    await page.reload();
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await expect(page.getByTestId("member-list").getByText(teammate.email)).toBeVisible({
      timeout: 30_000,
    });

    await theirContext.close();
  });

  test("an invite link cannot be redeemed by a different account", async ({
    authedPage: page,
    browser,
  }) => {
    const invited = makeUser();
    const interloper = makeUser();
    // Each account is registered from its own context — see the note in the test above.
    const invitedContext = await browser.newContext();
    const theirContext = await browser.newContext();
    for (const [account, context] of [
      [invited, invitedContext],
      [interloper, theirContext],
    ] as const) {
      const res = await context.request.post(`${AUTH}/api/auth/sign-up/email`, {
        data: { email: account.email, password: account.password, name: account.name },
      });
      expect(res.ok(), `sign-up failed: ${res.status()} ${await res.text()}`).toBeTruthy();
    }
    await invitedContext.close();

    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await page.getByLabel("Invite by email").fill(invited.email);
    await page.getByRole("button", { name: "Invite" }).click();
    const inviteUrl = (
      await page.getByTestId("invite-link").locator("code").innerText()
    ).trim();

    // Someone else, holding the link, must not be able to redeem it.
    const theirPage = await theirContext.newPage();
    await theirPage.goto(inviteUrl);
    await theirPage.getByTestId("accept-invite").click();

    await expect(theirPage.getByRole("alert")).toContainText(invited.email);
    await theirContext.close();
  });
});
