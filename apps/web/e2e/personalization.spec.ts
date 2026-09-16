import { expect, test } from "./fixtures";

/**
 * Personalization — the font and size of the editor, previewed on the real page.
 *
 * The bargain worth pinning: a change shows immediately, and Cancel puts back exactly what was
 * there. A setting you were only trying out must not follow you into the next session.
 */
test.describe("personalization", () => {
  const editorFont = (page: import("@playwright/test").Page) =>
    page
      .locator(".bn-editor")
      .first()
      .evaluate((el) => {
        const style = getComputedStyle(el);
        return { family: style.fontFamily, size: style.fontSize };
      });

  test("previews on the open page, and only keeps it if you save", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially("how this reads matters");

    const before = await editorFont(page);
    expect(before.size).toBe("16px");

    await page.getByRole("button", { name: "Personalization" }).click();
    await expect(page.getByTestId("personalization")).toBeVisible();

    // The editor behind the dialog changes as soon as a choice is made — nothing saved yet.
    await page.getByTestId("pref-font-serif").click();
    await page.getByTestId("pref-size-20").click();
    const previewed = await editorFont(page);
    expect(previewed.size).toBe("20px");
    expect(previewed.family).not.toBe(before.family);

    // Cancel puts back exactly what was there.
    await page.getByTestId("pref-cancel").click();
    await expect(page.getByTestId("personalization")).toHaveCount(0);
    expect(await editorFont(page)).toEqual(before);

    // Saving keeps it, and it is still there after a reload.
    await page.getByRole("button", { name: "Personalization" }).click();
    await page.getByTestId("pref-font-serif").click();
    await page.getByTestId("pref-size-20").click();
    await page.getByTestId("pref-save").click();
    await expect(page.getByTestId("personalization")).toHaveCount(0);

    await page.reload();
    await expect(page.locator('[contenteditable="true"]').first()).toContainText(
      "how this reads matters",
      { timeout: 30_000 },
    );
    const after = await editorFont(page);
    expect(after.size).toBe("20px");
    expect(after.family).toBe(previewed.family);
  });

  test("Escape closes it without keeping the preview", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();
    await editor.pressSequentially("unchanged");

    const before = await editorFont(page);

    await page.getByRole("button", { name: "Personalization" }).click();
    await page.getByTestId("pref-size-14").click();
    expect((await editorFont(page)).size).toBe("14px");

    await page.keyboard.press("Escape");
    await expect(page.getByTestId("personalization")).toHaveCount(0);
    expect(await editorFont(page)).toEqual(before);
  });
});
