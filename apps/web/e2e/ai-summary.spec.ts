import { apiPost } from "./helpers/api";
import { expect, test } from "./fixtures";

/**
 * Phase 3 — the ambient daily AI summary. Tested at the API level (there is no UI trigger yet):
 * the authenticated endpoint returns a non-empty summary for the day. Runs against the offline
 * fallback provider (no AI_API_KEY needed), so it needs no network / model.
 */
test.describe("ai daily summary", () => {
  test("POST /ai/daily-summary returns a summary for today", async ({ authedPage: page }) => {
    // Create a little activity so the summary has something to reflect.
    await page.getByRole("button", { name: "New page" }).click();
    await page.waitForTimeout(1500); // let it upload to Postgres

    const res = await apiPost(page.request, "/ai/daily-summary", {});
    expect(res.ok(), `daily-summary failed: ${res.status()} ${await res.text()}`).toBeTruthy();

    const body = (await res.json()) as { date: string; summary: string };
    expect(body.date).toBeTruthy();
    expect(typeof body.summary).toBe("string");
    expect(body.summary.trim().length).toBeGreaterThan(0);
  });
});
