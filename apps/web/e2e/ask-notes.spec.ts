import { expect, test, type Page } from "./fixtures";

/**
 * Second brain, phase D — asking a question of your own notes.
 *
 * The engine is STUBBED, as everywhere else on this side of the wire: the suite must never
 * spend the operator's AI subscription, and a real model would make the assertions
 * non-deterministic. What is worth proving here is the plumbing that pytest cannot see —
 * that retrieval happens on the device and sends the right notes, that the answer and its
 * sources reach the screen, and that nothing is offered when no engine exists.
 */
const ASK_TASK = { key: "ask", label: "Ask my notes", whole_document: false, scope: "search" };
const EDITOR_TASKS = [
  { key: "summarize", label: "Summarize", whole_document: true, scope: "editor" },
  { key: "shorten", label: "Make shorter", whole_document: false, scope: "editor" },
];

interface Captured {
  task?: string;
  text?: string;
  question?: string;
}

/** Stub the engine, and capture whatever the client decided to send it. */
async function stubAsk(page: Page, options: { available: boolean; reply?: string }) {
  const captured: Captured = {};
  await page.route("**/ai/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        engine: options.available ? "stub" : "offline",
        available: options.available,
        tasks: options.available ? [...EDITOR_TASKS, ASK_TASK] : [],
      }),
    }),
  );

  const reply = options.reply ?? "You decided to ship on Friday [1].";
  const half = Math.ceil(reply.length / 2);
  await page.route("**/ai/compose/stream", (route) => {
    Object.assign(captured, route.request().postDataJSON() as Captured);
    return route.fulfill({
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
    });
  });
  return captured;
}

async function newPageWithText(page: Page, title: string, text: string) {
  const before = page.url();
  await page.getByRole("button", { name: "New page" }).click();
  await expect.poll(() => page.url(), { timeout: 20_000 }).not.toBe(before);
  await expect(page.getByTestId("page-title")).toHaveValue("Untitled", { timeout: 20_000 });
  await page.getByTestId("page-title").fill(title);
  await expect(page.getByRole("button", { name: title })).toBeVisible({ timeout: 20_000 });
  const editor = page.locator('[contenteditable="true"]').first();
  await editor.click();
  await editor.pressSequentially(text);
  await page.waitForTimeout(1500); // debounced persist to the replica
}

async function openPalette(page: Page, query: string) {
  await page.getByRole("button", { name: /search/i }).click();
  const dialog = page.getByRole("dialog", { name: "Search" });
  await dialog.getByPlaceholder("Search pages, items, blocks…").fill(query);
  return dialog;
}

test.describe("ask my notes", () => {
  test("answers from the right page and links back to it", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    const topic = `quibblewick${stamp}`;
    const captured = await stubAsk(page, { available: true });

    await newPageWithText(page, `Launch${stamp}`, `We agreed the ${topic} ships on Friday.`);
    await newPageWithText(page, `Lunch${stamp}`, "sandwiches and a flask of soup");

    const dialog = await openPalette(page, `when does ${topic} ship`);
    await dialog.getByTestId("ask-notes").click();

    await expect(page.getByTestId("ask-answer")).toContainText("ship on Friday", {
      timeout: 20_000,
    });

    // Retrieval ran on the device: the request carried the question and the matching note,
    // and left the unrelated page out of it.
    expect(captured.task).toBe("ask");
    expect(captured.question).toContain(topic);
    expect(captured.text).toContain(`Launch${stamp}`);
    expect(captured.text).toContain("ships on Friday");
    expect(captured.text).not.toContain("flask of soup");

    // The answer cites its sources, and a source opens the page it came from.
    const source = page.getByTestId("ask-source");
    await expect(source).toHaveCount(1);
    await expect(source).toContainText(`Launch${stamp}`);
    await source.click();
    await expect(page.getByTestId("page-title")).toHaveValue(`Launch${stamp}`, {
      timeout: 20_000,
    });
  });

  test("writes the answer into the open page only when asked to", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const topic = `flintcabble${stamp}`;
    await stubAsk(page, { available: true, reply: `The ${topic} was moved to Tuesday [1].` });

    await newPageWithText(page, `Plan${stamp}`, `The ${topic} was moved to Tuesday.`);

    const dialog = await openPalette(page, `when is ${topic}`);
    await dialog.getByTestId("ask-notes").click();
    await expect(page.getByTestId("ask-answer")).toContainText("Tuesday", { timeout: 20_000 });

    // AI proposes, the user disposes: the page is untouched until the button is pressed.
    const editor = page.locator('[contenteditable="true"]').first();
    await expect(editor).not.toContainText("moved to Tuesday [1]");

    await page.getByTestId("ask-insert").click();
    await page.keyboard.press("Escape");
    await expect(editor).toContainText("moved to Tuesday [1]", { timeout: 20_000 });
    // The cited page is inserted as a real link, so the answer stays checkable.
    await expect(page.getByTestId("page-link")).toHaveText(`Plan${stamp}`, { timeout: 20_000 });
  });

  test("says so when nothing matches, without calling the engine", async ({
    authedPage: page,
  }) => {
    const stamp = Date.now().toString(36);
    const captured = await stubAsk(page, { available: true });

    await newPageWithText(page, `Recipes${stamp}`, "onions garlic and a bay leaf");

    const dialog = await openPalette(page, `what about wrenchbolting${stamp}`);
    await dialog.getByTestId("ask-notes").click();

    await expect(page.getByTestId("ask-empty")).toBeVisible({ timeout: 20_000 });
    // The point of the empty state: an unanswerable question must not spend a request.
    expect(captured.task).toBeUndefined();
  });

  test("offers nothing at all when no engine is configured", async ({ authedPage: page }) => {
    const stamp = Date.now().toString(36);
    await stubAsk(page, { available: false });

    await newPageWithText(page, `Notes${stamp}`, "something worth asking about");

    const dialog = await openPalette(page, "something");
    await expect(dialog.getByTestId("ask-notes")).toHaveCount(0);
    // ...and the shortcut is inert rather than silently failing.
    await dialog.getByPlaceholder("Search pages, items, blocks…").press("ControlOrMeta+Enter");
    await expect(page.getByTestId("ask-answer")).toHaveCount(0);
  });
});
