import { expect, test } from "./fixtures";

/**
 * Theme mode — System → Light → Dark, applied as the `dark` class on <html> (Tailwind's class
 * strategy) and persisted per device. The regression this guards: the BlockNote editor used to
 * follow `prefers-color-scheme` on its own, rendering a dark editor inside a light shell.
 */
test.describe("theme", () => {
  test("cycles system → light → dark and persists across reload", async ({ authedPage: page }) => {
    const html = page.locator("html");
    const toggle = page.getByTestId("theme-toggle");

    // Default is System. The Playwright context has no colour-scheme preference set, so the
    // resolved theme is light.
    await expect(toggle).toContainText("System");
    await expect(html).not.toHaveClass(/dark/);

    await toggle.click();
    await expect(toggle).toContainText("Light");
    await expect(html).not.toHaveClass(/dark/);

    await toggle.click();
    await expect(toggle).toContainText("Dark");
    await expect(html).toHaveClass(/dark/);

    // Persisted per device: the choice survives a reload, with no light flash on boot.
    await page.reload();
    await expect(page.getByTestId("theme-toggle")).toContainText("Dark", { timeout: 30_000 });
    await expect(html).toHaveClass(/dark/);
  });

  test("dark mode themes the editor, not just the shell", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await expect(page.getByTestId("page-title")).toBeVisible();

    // Switch to Dark (System → Light → Dark).
    const toggle = page.getByTestId("theme-toggle");
    await toggle.click();
    await toggle.click();
    await expect(page.locator("html")).toHaveClass(/dark/);

    // BlockNote is driven by our store, so its own theme attribute must follow. Without this
    // the editor rendered its default (OS-derived) theme independently of the app shell.
    await expect(page.locator("[data-color-scheme]").first()).toHaveAttribute(
      "data-color-scheme",
      "dark",
    );
  });

  test("follows the OS preference when left on System", async ({ browser }) => {
    // A context that reports a dark OS preference should boot dark without any stored choice.
    const context = await browser.newContext({ colorScheme: "dark" });
    const page = await context.newPage();
    await page.goto("/");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await context.close();
  });
});
