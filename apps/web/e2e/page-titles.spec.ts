import { expect, test } from "./fixtures";
import { clickNewPage, expectNewPageOpened } from "./helpers/pages";

/**
 * Naming a page.
 *
 * Blank pages used to all be called "Untitled", so a sidebar full of them told you nothing, and
 * the name was a real value you had to delete by hand before typing your own.
 */
test.describe("page titles", () => {
  test("New page asks for the name first, and Escape makes nothing", async ({
    authedPage: page,
  }) => {
    const tree = page.getByTestId("page-tree");
    await expect(tree.getByText("No pages yet")).toBeVisible();

    await page.getByRole("button", { name: "New page" }).click();
    const field = page.getByRole("textbox", { name: "Page name" });
    await expect(field).toBeFocused();
    // The placeholder says what an empty Enter makes.
    await expect(field).toHaveAttribute("placeholder", "Untitled");

    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(tree.getByText("No pages yet")).toBeVisible();

    // A typed name: the page is made under it and opened, never as "Untitled" first.
    await page.getByRole("button", { name: "New page" }).click();
    await field.fill("Groceries");
    await field.press("Enter");
    await expect(page.getByTestId("page-title")).toHaveValue("Groceries", { timeout: 20_000 });
    await expect(tree.getByRole("button", { name: "Groceries", exact: true })).toBeVisible();
    await expect(tree.getByRole("button", { name: /^Untitled/ })).toHaveCount(0);
  });

  test("blank pages are numbered, and the name types over itself", async ({
    authedPage: page,
  }) => {
    const newPage = async () => {
      await clickNewPage(page);
      await expectNewPageOpened(page);
    };

    await newPage();
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled");
    await newPage();
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled 2");
    await newPage();
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled 3");

    // All three are told apart in the sidebar.
    for (const name of ["Untitled", "Untitled 2", "Untitled 3"]) {
      await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
    }

    // Clicking into an app-chosen name selects it, so the first thing typed replaces it — no
    // backspacing through a word you never wrote.
    const title = page.getByTestId("page-title");
    await title.click();
    await page.keyboard.type("Launch plan");
    await expect(title).toHaveValue("Launch plan");
    await expect(page.getByRole("button", { name: "Launch plan" })).toBeVisible({
      timeout: 20_000,
    });

    // A name you chose is left alone: clicking into it puts the caret where you clicked.
    await title.click();
    await page.keyboard.type("!");
    await expect(title).not.toHaveValue("!");

    // Naming one frees its number again, so the list does not creep upward forever: the page
    // just renamed was "Untitled 3", and that slot is handed back out rather than going to 4.
    await clickNewPage(page);
    await expect(page.getByTestId("page-title")).toHaveValue("Untitled 3");
  });
});
