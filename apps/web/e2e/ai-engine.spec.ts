import { expect, test, type Page } from "./fixtures";
import { apiGet } from "./helpers/api";
import { clickNewPage, expectNewPageOpened } from "./helpers/pages";

/**
 * Where AI runs, and what the server hands over so a LOCAL engine can run it.
 *
 * The desktop shell can spawn the user's own `claude`/`codex` binary and do inference on their
 * machine (apps/desktop/src-tauri/src/ai.rs). This suite drives the WEB build, so none of that
 * is reachable here. What IS reachable, and what this file covers:
 *
 *   - the browser chooses in Personalization between the server and Off, and Off hides AI;
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
  test("a browser chooses the server or Off in Personalization, and Off hides AI", async ({
    authedPage: page,
  }) => {
    await stubStatus(page);
    await clickNewPage(page);
    await expectNewPageOpened(page);
    await page.locator(".bn-editor").click();
    await page.keyboard.type("some words to work on");
    await expect(page.getByTestId("summarize-page")).toBeVisible({ timeout: 15_000 });

    // No separate row in the sidebar: AI is a section of Personalization.
    await expect(page.getByRole("button", { name: "AI engine" })).toHaveCount(0);
    await page.getByRole("button", { name: "Personalization" }).click();
    await page.getByTestId("pref-section-ai").click();
    const ai = page.getByTestId("ai-settings");
    // A browser has no CLI to spawn: the server, or nothing.
    await expect(ai.getByTestId("ai-engine-server")).toHaveAttribute("aria-pressed", "true");
    await ai.getByTestId("ai-engine-off").click();
    await page.getByTestId("pref-save").click();

    await expect(page.getByTestId("summarize-page")).toHaveCount(0);

    // Remembered on this device.
    await page.reload();
    await expect(page.locator(".bn-editor")).toContainText("some words to work on", {
      timeout: 20_000,
    });
    await page.waitForTimeout(1000); // the engine status is read after the editor mounts
    await expect(page.getByTestId("summarize-page")).toHaveCount(0);
  });

  test("an own API key is kept on the server and shown only by its last four characters", async ({
    authedPage: page,
  }) => {
    // No model is ever called here: the key is fake, and nothing on the page asks the engine.
    const key = "sk-ant-test-0000000000wxyz";
    await page.getByRole("button", { name: "Personalization" }).click();
    await page.getByTestId("pref-section-ai").click();
    const own = page.getByTestId("own-key");
    // No field asks for a key until the row is opened.
    await expect(own.getByLabel("API key")).toHaveCount(0);
    await own.getByTestId("own-key-toggle").click();
    await own.getByTestId("own-key-provider-anthropic").click();
    await own.getByLabel("Model").fill("claude-haiku-5-5");
    await own.getByLabel("API key").fill(key);
    await own.getByTestId("own-key-save").click();

    const summary = own.getByTestId("own-key-summary");
    await expect(summary).toHaveText("Anthropic · claude-haiku-5-5 · key …wxyz");
    // This user's requests now run on that key.
    await expect(page.getByTestId("ai-engine-state")).toHaveText("Server engine: Own API key.");
    // The key itself never comes back.
    const res = await apiGet(page.request, "/ai/settings");
    expect(await res.text()).not.toContain(key);

    // Kept on the server, not in this tab.
    await page.reload();
    await page.getByRole("button", { name: "Personalization" }).click();
    await expect(summary).toHaveText("Anthropic · claude-haiku-5-5 · key …wxyz", {
      timeout: 20_000,
    });

    // Closed again after the reload: the summary shows, the fields do not.
    await expect(own.getByLabel("API key")).toHaveCount(0);
    await own.getByTestId("own-key-toggle").click();
    await own.getByRole("button", { name: "Remove key" }).click();
    await expect(own.getByText("Key removed.")).toBeVisible();
    await expect(summary).toHaveCount(0);
  });

  test("in a browser the CLI row offers buttons: the desktop app and each install page", async ({
    authedPage: page,
  }) => {
    await page.getByRole("button", { name: "Personalization" }).click();
    await page.getByTestId("pref-section-ai").click();
    const cli = page.getByTestId("cli-tools");
    const download = cli.getByRole("link", { name: "Get the desktop app" });
    await expect(download).toHaveCount(0);

    await cli.getByTestId("cli-tools-toggle").click();
    await expect(download).toHaveAttribute("href", /^https:\/\//);
    for (const label of ["Claude Code", "Codex", "Gemini CLI"]) {
      await expect(cli.getByRole("link", { name: `Install ${label}` })).toHaveAttribute(
        "href",
        /^https:\/\//,
      );
    }
    // Buttons, not a numbered list of terminal steps.
    await expect(cli.locator("ol")).toHaveCount(0);
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
    await clickNewPage(page);
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
