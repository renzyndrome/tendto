import { expect, test } from "./fixtures";

/**
 * Workspace creation + switching. Unlike pages/collections, a workspace cannot be written to
 * the replica and synced up — the upload path refuses to create one (the writer must already
 * be a member), so this goes through POST /workspaces. The row then syncs back down and the
 * switcher lists it.
 *
 * Also guards tenancy: content created in one workspace must not leak into another.
 */
test.describe("workspaces", () => {
  test("create a second workspace, switch between them, and keep content separate", async ({
    authedPage: page,
  }) => {
    // A page that belongs to the original (bootstrapped) workspace.
    const firstPageTitle = `first-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(firstPageTitle);
    await expect(page.getByRole("button", { name: firstPageTitle })).toBeVisible();

    // Create a second workspace.
    const switcher = page.getByRole("button", { name: "Switch workspace" });
    await expect(switcher).toContainText("My Workspace");
    await switcher.click();
    await page.getByRole("menuitem", { name: "+ New workspace" }).click();
    const nameInput = page.getByLabel("New workspace name");
    await nameInput.fill("Second Workspace");
    await nameInput.press("Enter");

    // The switcher reflects the new active workspace once the row has synced down.
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Second Workspace",
      { timeout: 30_000 },
    );

    // Tenancy: the first workspace's page must NOT be visible here.
    await expect(page.getByRole("button", { name: firstPageTitle })).toHaveCount(0);
    await expect(page.getByText("No pages yet")).toBeVisible();

    // Give the new workspace its own page.
    const secondPageTitle = `second-${Date.now().toString(36)}`;
    await page.getByRole("button", { name: "New page" }).click();
    await page.getByTestId("page-title").fill(secondPageTitle);
    await expect(page.getByRole("button", { name: secondPageTitle })).toBeVisible();

    // Switch back — the original page returns and the new one is gone.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "My Workspace" }).click();
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "My Workspace",
    );
    await expect(page.getByRole("button", { name: firstPageTitle })).toBeVisible({
      timeout: 30_000,
    });
    await expect(page.getByRole("button", { name: secondPageTitle })).toHaveCount(0);
  });

  test("recovers when the remembered workspace is no longer ours", async ({
    authedPage: page,
  }) => {
    // Simulates a device whose stored workspace no longer belongs to the user — a workspace
    // deleted elsewhere, another account's leftovers, or a reset dev database. Before the
    // server's list became authoritative this wedged the app: the stale id stayed active and
    // every workspace-scoped API call 404'd ("Workspace not found" in settings).
    await page.evaluate(() =>
      localStorage.setItem("tendto:workspace", "00000000-0000-4000-8000-000000000000"),
    );
    await page.reload();

    // Boot falls back to a workspace the server actually acknowledges...
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "My Workspace",
      { timeout: 30_000 },
    );
    // ...and it is genuinely usable: settings loads instead of erroring.
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "Workspace settings" }).click();
    await expect(page.getByTestId("member-list")).toBeVisible();
    await expect(page.getByText("Workspace not found")).toHaveCount(0);
  });

  test("the switcher lists each workspace once", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await expect(page.getByRole("menuitem", { name: "My Workspace" })).toHaveCount(1);
  });

  test("the active workspace survives a reload", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Switch workspace" }).click();
    await page.getByRole("menuitem", { name: "+ New workspace" }).click();
    const nameInput = page.getByLabel("New workspace name");
    await nameInput.fill("Sticky Workspace");
    await nameInput.press("Enter");

    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Sticky Workspace",
      { timeout: 30_000 },
    );

    // Without persistence, boot would fall back to the first workspace ("My Workspace").
    await page.reload();
    await expect(page.getByRole("button", { name: "Switch workspace" })).toContainText(
      "Sticky Workspace",
      { timeout: 30_000 },
    );
  });
});
