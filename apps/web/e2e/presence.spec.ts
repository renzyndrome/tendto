import { expect, test } from "./fixtures";
import { makeUser } from "./helpers/data";

/**
 * Presence — "who else is reading this".
 *
 * The property worth guarding is the quiet one: alone, nothing renders at all. Presence is not
 * a status panel that happens to be empty; it is absent until a teammate is genuinely on the
 * same page, which is what keeps it on the calm side of the collaboration-noise guardrail.
 *
 * The interesting case needs two real browser contexts, since a marker that only ever showed
 * your own tab would prove nothing.
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";

// The server polls lazily when you are alone (10s) — so a teammate arriving can take a couple
// of beats to show up. Generous, because this is inherently a timed signal.
const APPEAR_TIMEOUT = 30_000;

test.describe("presence", () => {
  test("nothing renders when you are alone", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill("Solo");

    // Give the loop time to have polled at least once, so this isn't just "too early".
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("presence-bar")).toHaveCount(0);

    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();
    await page.waitForTimeout(2_000);
    await expect(page.getByTestId("presence-bar")).toHaveCount(0);
  });

  test("a teammate on the same page shows up, and clears when they leave", async ({
    authedPage: page,
    browser,
  }) => {
    const shared = `presence-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(shared);
    await expect(page.getByRole("button", { name: shared })).toBeVisible();

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
    await expect(theirPage.getByRole("button", { name: shared })).toBeVisible({
      timeout: 30_000,
    });

    // Still alone until they actually open the page — being in the workspace is not presence.
    // Settle first, so this would fail if presence were simply broken rather than scoped.
    await page.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: shared }).click();
    await page.waitForTimeout(3_000);
    await expect(page.getByTestId("presence-bar")).toHaveCount(0);

    await theirPage.getByRole("button", { name: shared }).click();

    // Now they are here: initials, and the full name on hover.
    const bar = page.getByTestId("presence-bar");
    await expect(bar).toBeVisible({ timeout: APPEAR_TIMEOUT });
    await expect(bar).toHaveAttribute("aria-label", `${teammate.name} is also here`);
    await expect(page.getByTestId("presence-viewer")).toHaveCount(1);

    // ...and gone when they navigate away. `leave` is sent on unmount, so this should not
    // have to wait for the TTL.
    await theirPage.getByRole("button", { name: "Calendar" }).click();
    await expect(page.getByTestId("presence-bar")).toHaveCount(0, { timeout: APPEAR_TIMEOUT });

    await theirContext.close();
  });

  test("presence is per-page, not per-workspace", async ({ authedPage: page, browser }) => {
    // Two pages in one shared workspace: being in the same workspace must not put someone on
    // your page. This is the line between "who's here" and an online list.
    const mine = `mine-${Date.now().toString(36)}`;
    const theirs = `theirs-${Date.now().toString(36)}`;
    for (const title of [mine, theirs]) {
      await page.getByRole("button", { name: "New page" }).click();
      // Wait for the NEW editor to mount before typing. The previous page's title box is still
      // in the DOM for a beat, and `fill` would happily rename that one instead — the same race
      // that bites `.last()` elsewhere in this suite.
      await expect(page.getByTestId("page-title")).toHaveValue("Untitled");
      await page.getByTestId("page-title").fill(title);
      await expect(page.getByRole("button", { name: title })).toBeVisible();
    }

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
    await expect(theirPage.getByRole("button", { name: theirs })).toBeVisible({
      timeout: 30_000,
    });
    await theirPage.getByRole("button", { name: theirs }).click();

    await page.getByRole("button", { name: "Close settings" }).click();
    await page.getByRole("button", { name: mine }).click();

    // They are online, in this workspace, on another page — and therefore invisible.
    await page.waitForTimeout(6_000);
    await expect(page.getByTestId("presence-bar")).toHaveCount(0);

    // Follow them and they appear, which proves the silence above was scoping and not failure.
    await page.getByRole("button", { name: theirs }).click();
    await expect(page.getByTestId("presence-bar")).toBeVisible({ timeout: APPEAR_TIMEOUT });

    await theirContext.close();
  });
});
