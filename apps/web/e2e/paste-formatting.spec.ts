import { expect, test } from "./fixtures";

/**
 * Pasting formatted content (from a webpage, doc, or another editor) must keep its formatting
 * AND survive the round-trip through the replica.
 *
 * The persistence half is the part worth guarding: blocks are stored as rows whose `content`
 * column holds BlockNote's props/inline-content/children as JSON, so anything the serializer
 * dropped would look fine until reload and then silently flatten to plain text.
 */
const RICH_HTML = [
  "<h2>Pasted heading</h2>",
  '<p>Some <strong>bold</strong> and <em>italic</em> and <a href="https://example.com">a link</a>.</p>',
  "<ul><li>bullet one</li><li>bullet two</li></ul>",
  "<ol><li>numbered</li></ol>",
  "<blockquote>a quote</blockquote>",
  "<pre><code>const x = 1;</code></pre>",
].join("");

test.describe("paste formatting", () => {
  test.use({ permissions: ["clipboard-read", "clipboard-write"] });

  test("rich text keeps its formatting through a reload", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await page.locator(".bn-editor").click();

    await page.evaluate(async (html) => {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob(["plain fallback"], { type: "text/plain" }),
        }),
      ]);
    }, RICH_HTML);
    await page.keyboard.press("ControlOrMeta+V");

    const editor = page.locator(".bn-editor");
    await expect(editor).toContainText("Pasted heading");

    async function assertFormattingPresent(stage: string) {
      const html = await editor.innerHTML();
      expect(html, `heading missing ${stage}`).toMatch(/data-level="2"|<h2/);
      expect(html, `bold missing ${stage}`).toContain("<strong");
      expect(html, `italic missing ${stage}`).toContain("<em");
      expect(html, `link missing ${stage}`).toContain("example.com");
      expect(html, `bullet list missing ${stage}`).toContain("bulletListItem");
      expect(html, `numbered list missing ${stage}`).toContain("numberedListItem");
      expect(html, `code block missing ${stage}`).toMatch(/codeBlock|<code/);
    }

    await assertFormattingPresent("after paste");

    // Let the debounced save land, then prove it round-tripped through the replica.
    await page.waitForTimeout(1500);
    await page.reload();
    await expect(page.locator(".bn-editor")).toContainText("Pasted heading", { timeout: 30_000 });
    await assertFormattingPresent("after reload");
  });

  test("plain text paste still works", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "New page" }).click();
    await page.locator(".bn-editor").click();

    await page.evaluate(async () => {
      await navigator.clipboard.writeText("just plain text");
    });
    await page.keyboard.press("ControlOrMeta+V");

    await expect(page.locator(".bn-editor")).toContainText("just plain text");
  });
});
