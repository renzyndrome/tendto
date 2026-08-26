import { expect, test } from "./fixtures";
import { aiEngineConfigured } from "./helpers/api";

/**
 * Daily recap — the surface for the one ambient AI feature: structured "needs attention" rows
 * (overdue/upcoming), activity stats, and — when a real engine is configured — AI prose.
 *
 * The e2e stack runs with no AI engine configured (empty AI_CLI / AI_API_KEY in .env), so the
 * server reports engine "offline" and the UI renders the structured digest alone. That
 * determinism is part of the contract — the suite must stay network-free and must never spend
 * anyone's subscription. If an engine IS configured locally, content becomes nondeterministic
 * (and billable), so the test skips — decided from `/ai/status`, which costs nothing. It used
 * to probe by calling the recap itself, which meant the very check that existed to avoid
 * spending the subscription spent one call of it.
 */

const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
const API = process.env.VITE_API_URL ?? "http://localhost:18000";

/** Local YYYY-MM-DD, `delta` days from today. */
function dayKey(delta: number): string {
  const d = new Date();
  d.setDate(d.getDate() + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

test.describe("daily recap", () => {
  test("colors the overdue and upcoming tasks, and summarizes wider periods", async ({
    authedPage: page,
  }) => {
    const late = `late-${Date.now().toString(36)}`;
    const soon = `soon-${Date.now().toString(36)}`;

    // Two tasks through the real UI: one overdue, one due tomorrow.
    await page.getByRole("button", { name: "New collection" }).click();
    await expect(page).toHaveURL(/\/c\//);
    await page.getByRole("button", { name: "Table" }).click();
    const table = page.getByTestId("table");
    const rows: Array<readonly [string, string]> = [
      [late, dayKey(-3)],
      [soon, dayKey(1)],
    ];
    for (const [index, [title, due]] of rows.entries()) {
      // New items append at the BOTTOM. Wait for the new row to actually MOUNT before
      // targeting .last() — otherwise the second pass resolves against the old DOM and
      // silently edits the first row instead (which is exactly what happened).
      await page.getByRole("button", { name: "+ New item" }).click();
      await expect(table.getByPlaceholder("Untitled")).toHaveCount(index + 1);
      const row = table.getByPlaceholder("Untitled").last();
      await row.fill(title);
      await row.blur();
      await table.locator('input[type="date"]').last().fill(due);
    }

    // The recap reads POSTGRES, not the replica — gate on the rows having *uploaded* by
    // polling the endpoint until the digest names them. Engine check comes FIRST: with a real
    // engine every poll iteration would be a real, billable model call.
    const { token } = (await (await page.request.get(`${AUTH}/api/auth/token`)).json()) as {
      token: string;
    };
    const fetchRecap = async () => {
      const res = await page.request.post(`${API}/ai/daily-summary`, {
        headers: { Authorization: `Bearer ${token}` },
        data: { date: dayKey(0), today: dayKey(0) },
      });
      return (await res.json()) as {
        engine: string;
        activity: { items_overdue: { title: string }[]; items_due_next: { title: string }[] };
      };
    };
    // FREE probe, and it comes before any polling: with a real engine every poll iteration
    // below would be a billable model call.
    test.skip(
      await aiEngineConfigured(page.request),
      "a real AI engine is configured — content is nondeterministic and billable",
    );
    await expect
      .poll(
        async () => {
          const body = await fetchRecap();
          return [...body.activity.items_overdue, ...body.activity.items_due_next].map(
            (item) => item.title,
          );
        },
        { timeout: 30_000, message: "the due items never reached Postgres" },
      )
      .toEqual(expect.arrayContaining([late, soon]));

    await page.getByRole("button", { name: "Daily recap" }).click();
    await expect(page).toHaveURL(/\/recap/);

    // Structured, colored rows: the late task under Needs attention as OVERDUE, the tomorrow
    // one as UPCOMING — each with its human due label.
    const overdue = page.getByTestId("recap-overdue").filter({ hasText: late });
    const upcoming = page.getByTestId("recap-upcoming").filter({ hasText: soon });
    await expect(overdue).toBeVisible({ timeout: 30_000 });
    await expect(overdue).toContainText("was due");
    await expect(upcoming).toContainText("due tomorrow");
    // Offline engine: the structure IS the recap — no prose block pretending to be AI.
    await expect(page.getByTestId("recap-prose")).toHaveCount(0);
    // Both tasks were created today, so the stats row counts them.
    await expect(page.getByTestId("recap-stats")).toContainText("Added");

    // Week: the label becomes a range; the needs-attention rows stay (they're anchored on
    // now, not on the period).
    await page.getByTestId("recap-period-week").click();
    await expect(page.getByTestId("recap-label")).toContainText("–");
    await expect(page.getByTestId("recap-overdue").filter({ hasText: late })).toBeVisible({
      timeout: 30_000,
    });

    // All time: no period stepping — there is nowhere to step.
    await page.getByTestId("recap-period-all").click();
    await expect(page.getByTestId("recap-label")).toHaveText("Everything so far");
    await expect(page.getByRole("button", { name: "Previous period" })).toHaveCount(0);

    // Back to Day, step to yesterday: a day with no activity still surfaces what needs
    // attention rather than claiming a calm day over a missed deadline.
    await page.getByTestId("recap-period-day").click();
    await page.getByRole("button", { name: "Previous period" }).click();
    await expect(page).toHaveURL(new RegExp(`/recap/${dayKey(-1)}`));
    await expect(page.getByTestId("recap-overdue").filter({ hasText: late })).toBeVisible({
      timeout: 30_000,
    });

    // And "next" never steps past a period that already includes today.
    await page.getByRole("button", { name: "Today", exact: true }).click();
    await expect(page.getByRole("button", { name: "Next period" })).toBeDisabled();
  });
});
