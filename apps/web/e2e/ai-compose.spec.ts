import { expect, test, type Page } from "./fixtures";

/**
 * Interactive AI — Summarize a page, and Ask AI on a selection.
 *
 * The engine is STUBBED here, deliberately. Two reasons: a real model makes the assertions
 * non-deterministic, and the suite must never spend the operator's AI subscription (the same
 * rule the recap spec follows). What matters on this side of the wire is the plumbing — does
 * the button appear only when an engine exists, does the result reach the document, does
 * "Discard" leave it alone — and none of that needs real inference. The prompts, the task
 * registry and every failure mode are covered by pytest in app/tests/test_ai_compose.py.
 */
const TASKS = [
  { key: "summarize", label: "Summarize", whole_document: true, scope: "editor" },
  { key: "improve", label: "Improve writing", whole_document: false, scope: "editor" },
  { key: "shorten", label: "Make shorter", whole_document: false, scope: "editor" },
  { key: "fix", label: "Fix spelling & grammar", whole_document: false, scope: "editor" },
];

/** Pretend an engine is (or isn't) configured, whatever the dev .env actually says. */
async function stubEngine(page: Page, options: { available: boolean; reply?: string }) {
  await page.route("**/ai/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        engine: options.available ? "stub" : "offline",
        available: options.available,
        tasks: options.available ? TASKS : [],
      }),
    }),
  );
  const reply = options.reply ?? "A tidy replacement.";
  // The editor streams, so the stub speaks SSE. Split into two deltas so the assembling path
  // is exercised rather than a single whole-answer frame.
  const half = Math.ceil(reply.length / 2);
  await page.route("**/ai/compose/stream", (route) =>
    route.fulfill({
      status: 200,
      contentType: "text/event-stream",
      body: [
        `data: ${JSON.stringify({ delta: reply.slice(0, half) })}`,
        "",
        `data: ${JSON.stringify({ delta: reply.slice(half) })}`,
        "",
        `data: ${JSON.stringify({ done: true, text: reply, truncated: false })}`,
        "",
        "",
      ].join("\n"),
    }),
  );
}

async function newPageWithText(page: Page, text: string) {
  await page.getByRole("button", { name: "New page" }).click();
  await expect(page.getByTestId("page-title")).toHaveValue("Untitled");
  await page.locator(".bn-editor").click();
  await page.keyboard.type(text);
}

test.describe("interactive AI", () => {
  test("no engine configured means no AI anywhere", async ({ authedPage: page }) => {
    // The offline fallback echoes its input, so an "improve" would replace a paragraph with
    // itself. Better to have no button than a button that cannot work.
    await stubEngine(page, { available: false });
    await newPageWithText(page, "Some notes.");

    await expect(page.getByTestId("summarize-page")).toHaveCount(0);
    await page.keyboard.press("Control+A");
    await expect(page.getByRole("button", { name: "Ask AI" })).toHaveCount(0);
  });

  test("Summarize puts the summary at the top of the page", async ({ authedPage: page }) => {
    await stubEngine(page, { available: true, reply: "- Ship on the 10th" });
    await newPageWithText(page, "The launch slipped to the tenth because onboarding is late.");

    await page.getByTestId("summarize-page").click();
    // The page-level button skips the menu — there is nothing to choose.
    await expect(page.getByTestId("ai-result")).toHaveText("- Ship on the 10th");
    await page.getByTestId("ai-keep").click();

    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    const editor = page.locator(".bn-editor");
    await expect(editor).toContainText("Ship on the 10th");
    // Above the original text, not appended to it.
    const body = (await editor.innerText()).trim();
    expect(body.indexOf("Ship on the 10th")).toBeLessThan(body.indexOf("The launch slipped"));

    // And it is a real edit: the reload proves it reached the replica.
    await page.waitForTimeout(1200);
    await page.reload();
    await expect(page.locator(".bn-editor")).toContainText("Ship on the 10th", {
      timeout: 30_000,
    });
  });

  test("Ask AI rewrites the selected text in place", async ({ authedPage: page }) => {
    await stubEngine(page, { available: true, reply: "The meeting is on Tuesday." });
    await newPageWithText(page, "teh meetign is on tuesday");

    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Ask AI" }).click();

    // A selection gets the menu; the page button does not.
    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await page.getByTestId("ai-task-fix").click();
    await expect(page.getByTestId("ai-result")).toHaveText("The meeting is on Tuesday.");
    await page.getByTestId("ai-keep").click();

    const editor = page.locator(".bn-editor");
    await expect(editor).toContainText("The meeting is on Tuesday.");
    await expect(editor).not.toContainText("meetign");
  });

  test("rewriting part of a paragraph leaves the rest alone", async ({ authedPage: page }) => {
    /*
     * The bug this exists for: `editor.getSelection()` returns the WHOLE blocks a selection
     * touches, while `getSelectedText()` returns only the highlighted words. Replacing those
     * blocks with a rewrite of the highlighted part therefore deleted the rest of the
     * paragraph. Highlighting one word is the cheapest way to catch that ever coming back.
     */
    await stubEngine(page, { available: true, reply: "MIDDLE" });
    await newPageWithText(page, "alpha bravo charlie");

    // Select just "bravo": to the end, then left over the last word, then extend back one more.
    await page.keyboard.press("Home");
    for (let i = 0; i < 6; i += 1) await page.keyboard.press("ArrowRight");
    for (let i = 0; i < 5; i += 1) await page.keyboard.press("Shift+ArrowRight");

    await page.getByRole("button", { name: "Ask AI" }).click();
    await page.getByTestId("ai-task-fix").click();
    await page.getByTestId("ai-keep").click();

    const editor = page.locator(".bn-editor");
    await expect(editor).toContainText("alpha MIDDLE charlie");
  });

  test("the selection menu offers rewrites, not Summarize", async ({ authedPage: page }) => {
    // Summarizing a highlighted sentence returns bullet points, and dropping a bullet list
    // into the middle of a paragraph is not what anyone asked for. Summarize is the page button.
    await stubEngine(page, { available: true });
    await newPageWithText(page, "some words to work on");

    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Ask AI" }).click();

    await expect(page.getByTestId("ai-task-improve")).toBeVisible();
    await expect(page.getByTestId("ai-task-shorten")).toBeVisible();
    await expect(page.getByTestId("ai-task-fix")).toBeVisible();
    await expect(page.getByTestId("ai-task-summarize")).toHaveCount(0);
  });

  test("the Ask AI button is readable, not a blank square", async ({ authedPage: page }) => {
    // The themed toolbar button renders `label` as an aria-label ONLY — a label-only button
    // passes a role query while showing the user nothing.
    await stubEngine(page, { available: true });
    await newPageWithText(page, "some words");

    await page.keyboard.press("Control+A");
    // Wait for the floating toolbar to actually mount before reading its text — the selection
    // and the toolbar's appearance are two separate frames.
    const button = page.getByRole("button", { name: "Ask AI" });
    await expect(button).toBeVisible();
    await expect(button).toHaveText("Ask AI");
  });

  test("nothing changes until you keep it", async ({ authedPage: page }) => {
    // The whole design: AI proposes, the user disposes. Undo is a poor apology for an editor
    // that rewrote your paragraph the moment you clicked.
    await stubEngine(page, { available: true, reply: "REPLACED" });
    await newPageWithText(page, "my original words");

    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Ask AI" }).click();
    await page.getByTestId("ai-task-improve").click();
    await expect(page.getByTestId("ai-result")).toHaveText("REPLACED");

    await page.getByRole("button", { name: "Discard" }).click();
    await expect(page.getByTestId("ai-panel")).toHaveCount(0);
    await expect(page.locator(".bn-editor")).toContainText("my original words");
    await expect(page.locator(".bn-editor")).not.toContainText("REPLACED");
  });

  test("an engine failure is reported, not silently swallowed", async ({ authedPage: page }) => {
    await stubEngine(page, { available: true });
    // Mid-stream failures cannot be an HTTP status — the response has already started — so
    // they arrive as a final `error` event. That path is the one worth guarding.
    await page.route("**/ai/compose/stream", (route) =>
      route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: [
          `data: ${JSON.stringify({ delta: "half a thou" })}`,
          "",
          `data: ${JSON.stringify({ error: "upstream exploded" })}`,
          "",
          "",
        ].join("\n"),
      }),
    );
    await newPageWithText(page, "some text");

    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Ask AI" }).click();
    await page.getByTestId("ai-task-shorten").click();

    await expect(page.getByRole("alert")).toContainText("upstream exploded");
    await expect(page.locator(".bn-editor")).toContainText("some text");
  });

  test("card descriptions stay plain", async ({ authedPage: page }) => {
    // A card description is a sentence or two — "summarize" is meaningless there, and the
    // dialog is deliberately spare (docs/planning/03 §guardrails).
    await stubEngine(page, { available: true });
    await page.getByRole("button", { name: "New collection" }).click();
    await page.getByRole("button", { name: "+ New item" }).click();
    await expect(page.getByTestId("item-detail")).toBeVisible();

    await expect(page.getByTestId("summarize-page")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Ask AI" })).toHaveCount(0);
  });
});
