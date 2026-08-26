import { expect, test, type Page } from "./fixtures";

/**
 * The evening recap — the ambient half of the daily summary.
 *
 * Device-local by design (see lib/recap-schedule.ts), so what matters here is the timing
 * logic: it must fire once at or after your hour, never twice, never before, and never at all
 * when it is switched off or notifications are.
 *
 * The recap request is STUBBED. The endpoint has its own pytest coverage, and a real call
 * would spend the operator's AI subscription — the standing rule for this suite.
 */
const STUB_RECAP = {
  start: "2026-08-21",
  end: "2026-08-21",
  summary: "You had a good day.",
  engine: "stub",
  activity: {
    focus_minutes: 50,
    focus_sessions: 2,
    items_completed: ["ship the thing", "reply to Ana"],
    items_created: [],
    pages_updated: ["Launch notes"],
    items_overdue: [],
    items_due_next: [],
  },
};

async function stubRecap(page: Page) {
  await page.route("**/ai/daily-summary", (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify(STUB_RECAP),
    }),
  );
}

/**
 * Notifications need a real browser grant, which headless Chromium refuses — so the class is
 * replaced with a recorder. That also lets the test read what the user would have been told.
 */
async function captureNotifications(page: Page) {
  await page.addInitScript(() => {
    const fired: { title: string; body?: string }[] = [];
    (window as unknown as Record<string, unknown>).__notifications = fired;
    class FakeNotification {
      static permission = "granted";
      static requestPermission = async () => "granted";
      onclick: (() => void) | null = null;
      constructor(title: string, options?: { body?: string }) {
        fired.push({ title, body: options?.body });
      }
      close() {}
    }
    (window as unknown as Record<string, unknown>).Notification = FakeNotification;
    // The app's own switch, separate from the browser grant.
    localStorage.setItem("tendto:notifications", "on");
  });
}

const notifications = (page: Page) =>
  page.evaluate(() => (window as unknown as { __notifications: { title: string; body?: string }[] }).__notifications);

/** Put the schedule in the past or the future relative to now. */
async function scheduleAt(page: Page, offsetMinutes: number, enabled = true) {
  await page.addInitScript(
    ({ offset, on }) => {
      const at = new Date(Date.now() + offset * 60_000);
      localStorage.setItem(
        "tendto:recap-schedule",
        JSON.stringify({ enabled: on, hour: at.getHours(), minute: at.getMinutes() }),
      );
      localStorage.removeItem("tendto:recap-delivered");
    },
    { offset: offsetMinutes, on: enabled },
  );
}

test.describe("evening recap", () => {
  test("arrives once when the hour has passed", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "notification stub is Chromium-shaped");
    await captureNotifications(page);
    await scheduleAt(page, -5); // five minutes ago
    await stubRecap(page);
    await signIn(page, testInfo);

    await expect
      .poll(async () => (await notifications(page)).length, { timeout: 20_000 })
      .toBe(1);

    const [first] = await notifications(page);
    expect(first.title).toBe("Your evening recap");
    // Built from the STRUCTURED digest, so it reads correctly with or without an AI engine.
    expect(first.body).toContain("2 done");
    expect(first.body).toContain("50m focused");

    // A reload must not re-deliver: the day is marked before the fetch, on purpose.
    await page.reload();
    await page.waitForTimeout(2_000);
    expect(await notifications(page)).toHaveLength(1);
  });

  test("stays quiet before the hour", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "notification stub is Chromium-shaped");
    await captureNotifications(page);
    await scheduleAt(page, 120); // two hours from now
    await stubRecap(page);
    await signIn(page, testInfo);

    await page.waitForTimeout(3_000);
    expect(await notifications(page)).toHaveLength(0);
  });

  test("stays quiet when switched off", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "notification stub is Chromium-shaped");
    await captureNotifications(page);
    await scheduleAt(page, -5, false);
    await stubRecap(page);
    await signIn(page, testInfo);

    await page.waitForTimeout(3_000);
    expect(await notifications(page)).toHaveLength(0);
  });

  test("the time is configurable and survives a reload", async ({ authedPage: page }) => {
    await page.getByRole("button", { name: "Daily recap" }).click();

    await expect(page.getByTestId("recap-schedule")).toBeVisible();
    // On by default — the daily summary is the signature ambient feature.
    await expect(page.getByTestId("recap-schedule-enabled")).toBeChecked();
    await expect(page.getByTestId("recap-schedule-time")).toHaveValue("21:00");

    await page.getByTestId("recap-schedule-time").fill("07:30");
    await page.reload();
    await expect(page.getByTestId("recap-schedule-time")).toHaveValue("07:30", {
      timeout: 30_000,
    });

    await page.getByTestId("recap-schedule-enabled").uncheck();
    await expect(page.getByTestId("recap-schedule-time")).toBeDisabled();
    await page.reload();
    await expect(page.getByTestId("recap-schedule-enabled")).not.toBeChecked({
      timeout: 30_000,
    });
  });

  test("it offers to fix the missing link rather than failing silently", async ({
    authedPage: page,
  }) => {
    // Headless Chromium denies notifications, which is the exact state someone lands in after
    // configuring an AI engine and wondering why nothing arrives. The row must offer the fix,
    // not describe it.
    await page.getByRole("button", { name: "Daily recap" }).click();

    await expect(page.getByTestId("recap-schedule-hint")).toHaveText("Turn on notifications");
    // ...and until that is sorted, there is nothing to test-send.
    await expect(page.getByTestId("recap-send-now")).toHaveCount(0);
  });

  test("it names the engine that will write the recap", async ({ authedPage: page }) => {
    // "Have I actually set up my AI?" answered on the page itself.
    await page.route("**/ai/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "claude-cli", available: true, tasks: [] }),
      }),
    );
    await page.getByRole("button", { name: "Daily recap" }).click();

    await expect(page.getByTestId("recap-engine")).toHaveText("Written by Claude CLI.");
  });

  test("with no engine it says the recap still works, just without the prose", async ({
    authedPage: page,
  }) => {
    // The digest is a plain database read, so "no engine" is a smaller loss than "broken".
    await page.route("**/ai/status", (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ engine: "offline", available: false, tasks: [] }),
      }),
    );
    await page.getByRole("button", { name: "Daily recap" }).click();

    await expect(page.getByTestId("recap-engine")).toContainText("No AI engine configured");
    await expect(page.getByTestId("recap-engine")).toContainText("AI_API_KEY");
  });

  test("Send one now proves the setup works", async ({ page, browserName }, testInfo) => {
    test.skip(browserName !== "chromium", "notification stub is Chromium-shaped");
    await captureNotifications(page);
    await scheduleAt(page, 120); // deliberately NOT due yet — the button ignores the clock
    await stubRecap(page);
    await signIn(page, testInfo);

    await page.getByRole("button", { name: "Daily recap" }).click();
    await page.getByTestId("recap-send-now").click();

    await expect
      .poll(async () => (await notifications(page)).length, { timeout: 15_000 })
      .toBe(1);
    expect((await notifications(page))[0].title).toBe("Your evening recap");
  });
});

/** Sign a fresh user in on a raw page (the fixture's authedPage navigates before our init
 *  scripts can seed localStorage). */
async function signIn(page: Page, testInfo: { workerIndex: number }) {
  const auth = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
  const stamp = `${Date.now().toString(36)}-${testInfo.workerIndex}`;
  const res = await page.request.post(`${auth}/api/auth/sign-up/email`, {
    data: {
      email: `e2e-recap-${stamp}@tendto.test`,
      password: "e2e-password-123",
      name: `e2e-recap-${stamp}`,
    },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New page" })).toBeVisible({ timeout: 30_000 });
}
