import { aiEngineConfigured, apiPost } from "./helpers/api";
import { expect, test } from "./fixtures";

/**
 * Phase 3 — the ambient daily AI summary, at the API level (the UI lives in recap.spec.ts).
 *
 * This one deliberately calls the REAL endpoint rather than a stub: its whole value is proving
 * the deployed stack wires it together — auth, routing, a real Postgres read — which a stub
 * would fake. So it is guarded instead: with an engine configured it SKIPS, because a live
 * model is both non-deterministic and billed to the operator. The prompts, the digest and every
 * failure mode are covered by pytest (app/tests/test_ai.py).
 *
 * To exercise it on a machine with AI_CLI set, blank that key and restart the API.
 */
test.describe("ai daily summary", () => {
  test("POST /ai/daily-summary returns a summary for today", async ({ authedPage: page }) => {
    test.skip(
      await aiEngineConfigured(page.request),
      "an AI engine is configured — skipping so the suite never spends the subscription",
    );

    // Create a little activity so the summary has something to reflect.
    await page.getByRole("button", { name: "New page" }).click();
    await page.waitForTimeout(1500); // let it upload to Postgres

    const res = await apiPost(page.request, "/ai/daily-summary", {});
    expect(res.ok(), `daily-summary failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const body = (await res.json()) as {
      end: string;
      engine: string;
      summary: string;
      activity: { pages_updated: string[] };
    };
    expect(body.end).toBeTruthy();
    expect(body.engine).toBeTruthy();
    expect(body.summary.trim().length).toBeGreaterThan(0);
    expect(Array.isArray(body.activity.pages_updated)).toBe(true);
  });
});
