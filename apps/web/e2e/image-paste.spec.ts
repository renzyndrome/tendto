import { expect, test } from "./fixtures";

// A 1×1 transparent PNG.
const PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

/**
 * Solo use — an image added to the editor is stored inline as a data URL (works offline, syncs as
 * text) and persists across reload. Driven via the slash-menu image block's file picker, which is
 * the same `uploadFile` handler that pasting or dropping an image uses. (Synthetic paste/drop
 * events don't route through BlockNote's file pipeline in headless Chromium — hence the picker.)
 */
test.describe("image insert", () => {
  test("adding an image stores it inline (data URL) and persists", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).toBeVisible({ timeout: 20_000 });
    await editor.click();

    await editor.pressSequentially("/image");
    await page.keyboard.press("Enter"); // insert the image block
    await page.locator(".bn-add-file-button").click();
    await page.locator('input[type="file"]').setInputFiles({
      name: "pixel.png",
      mimeType: "image/png",
      buffer: Buffer.from(PNG_B64, "base64"),
    });

    // Uploaded via our handler → an inline data-URL image.
    await expect(editor.locator('img[src^="data:image"]')).toBeVisible({ timeout: 10_000 });

    await page.waitForTimeout(1500); // debounced persist
    await page.reload();
    await expect(
      page.locator('[contenteditable="true"] img[src^="data:image"]').first(),
    ).toBeVisible({ timeout: 20_000 });
  });
});
