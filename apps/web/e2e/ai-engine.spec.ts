import { expect, test, type Page } from "./fixtures";
import { apiGet } from "./helpers/api";
import { expectNewPageOpened } from "./helpers/pages";

/**
 * Where AI runs, and what the server hands over so a LOCAL engine can run it.
 *
 * The desktop shell can spawn the user's own `claude`/`codex` binary and do inference on their
 * machine (apps/desktop/src-tauri/src/ai.rs). This suite drives the WEB build, so none of that
 * is reachable here. What IS reachable, and what this file covers:
 *
 *   - the browser build offers no engine choice at all, because it has nothing to spawn;
 *   - /ai/status carries the real system prompts, which is what makes a local run possible;
 *   - the recap prompt rides on that list without leaking into either menu.
 *
 * The local path itself is covered by `cargo test` plus the manual probe in docs/desktop.md.
 * Pretending a browser spec covers it would be worse than saying so.
 */
const RECAP_TASK = {
  key: "recap",
  label: "Daily recap",
  whole_document: true,
  scope: "recap",
  system: "RECAP PROMPT",
};

const EDITOR_TASKS = [
  {
    key: "summarize",
    label: "Summarize",
    whole_document: true,
    scope: "editor",
    system: "SUMMARIZE PROMPT",
  },
  {
    key: "improve",
    label: "Improve writing",
    whole_document: false,
    scope: "editor",
    system: "IMPROVE PROMPT",
  },
  {
    key: "fix",
    label: "Fix spelling & grammar",
    whole_document: false,
    scope: "editor",
    system: "FIX PROMPT",
  },
];

async function stubStatus(page: Page) {
  await page.route("**/ai/status", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        engine: "stub",
        available: true,
        tasks: [...EDITOR_TASKS, RECAP_TASK],
        user_text_marker: "<<<USER TEXT>>>",
      }),
    }),
  );
}

test.describe("AI engine", () => {
  test("a browser is offered no engine to choose", async ({ authedPage: page }) => {
    // The row and the dialog behind it exist only in the desktop build. A browser cannot spawn
    // a CLI, so a picker here would list one option and change nothing.
    await expect(page.getByRole("button", { name: "AI engine" })).toHaveCount(0);
    await expect(page.getByTestId("ai-settings")).toHaveCount(0);
  });

  test("every task carries the prompt a local engine would send", async ({
    authedPage: page,
  }) => {
    /*
     * The prompts stay owned by the server. A local engine sends them verbatim, so a copy in
     * the client would be a copy that drifts — and the first thing to drift away would be the
     * injection rule, which matters most where the engine is an agentic CLI on someone's own
     * machine. Reading /ai/status costs nothing and spends no inference.
     */
    const res = await apiGet(page.request, "/ai/status");
    expect(res.ok(), `ai/status failed: ${res.status()}`).toBeTruthy();
    const body = (await res.json()) as {
      user_text_marker: string;
      tasks: { key: string; scope: string; system: string }[];
    };

    expect(body.user_text_marker.length).toBeGreaterThan(0);
    for (const task of body.tasks) {
      expect(task.system, `task "${task.key}" shipped without a prompt`).toBeTruthy();
      // Every prompt carries the injection rule, which names the marker.
      expect(task.system, `task "${task.key}" lost the injection rule`).toContain(
        body.user_text_marker,
      );
    }
    // The recap prompt rides along so the evening summary can be written locally too.
    const recap = body.tasks.find((task) => task.key === "recap");
    expect(recap?.scope).toBe("recap");
  });

  test("the recap prompt stays out of the rewrite menu", async ({ authedPage: page }) => {
    // It is on the task list for one reason only: a local engine needs it. A row saying
    // "Daily recap" in a menu for rewriting a highlighted sentence would be nonsense.
    await stubStatus(page);
    await page.getByRole("button", { name: "New page" }).click();
    await expectNewPageOpened(page);
    await page.locator(".bn-editor").click();
    await page.keyboard.type("some words to work on");

    await page.keyboard.press("Control+A");
    await page.getByRole("button", { name: "Ask AI" }).click();

    await expect(page.getByTestId("ai-panel")).toBeVisible();
    await expect(page.getByTestId("ai-task-improve")).toBeVisible();
    await expect(page.getByTestId("ai-task-fix")).toBeVisible();
    await expect(page.getByTestId("ai-task-recap")).toHaveCount(0);
  });
});
