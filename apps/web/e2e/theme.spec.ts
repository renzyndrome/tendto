import { expect, test, type Page } from "./fixtures";

/**
 * Theme mode — System, Light or Dark, applied as the `dark` class on <html> (Tailwind's class
 * strategy) and persisted per device. It is chosen in Personalization, alongside the other two
 * things that decide how the app looks.
 *
 * The regression this guards: the BlockNote editor used to follow `prefers-color-scheme` on its
 * own, rendering a dark editor inside a light shell.
 */
async function openPersonalization(page: Page) {
  await page.getByRole("button", { name: "Personalization" }).click();
  await expect(page.getByTestId("personalization")).toBeVisible();
}

test.describe("theme", () => {
  test("picks a theme, and keeps it across a reload", async ({ authedPage: page }) => {
    const html = page.locator("html");

    // Default is System. The Playwright context states no colour-scheme preference, so the
    // resolved theme is light.
    await expect(html).not.toHaveClass(/dark/);

    await openPersonalization(page);
    await expect(page.getByTestId("pref-theme-system")).toHaveAttribute("aria-pressed", "true");

    await page.getByTestId("pref-theme-dark").click();
    // Applied before saving — the page behind the dialog is the preview.
    await expect(html).toHaveClass(/dark/);

    await page.getByTestId("pref-save").click();
    await expect(page.getByTestId("personalization")).toHaveCount(0);
    await expect(html).toHaveClass(/dark/);

    // Persisted per device: the choice survives a reload, with no light flash on boot.
    await page.reload();
    await expect(html).toHaveClass(/dark/, { timeout: 30_000 });
  });

  test("dark mode themes the editor, not just the shell", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await expect(page.getByTestId("page-title")).toBeVisible();

    await openPersonalization(page);
    await page.getByTestId("pref-theme-dark").click();
    await page.getByTestId("pref-save").click();
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
