import { type Page } from "@playwright/test";

import { expect, test } from "./fixtures";
import { makeUser } from "./helpers/data";

/**
 * Notifications: opt-in, device-local, and two independent sources (due reminders and the
 * Pomodoro).
 *
 * The real Notification API is stubbed rather than granted: headless Chromium reports
 * `Notification.permission === "denied"` even when Playwright grants the site permission, and
 * a delivered OS notification isn't observable from a test anyway. Stubbing lets us assert on
 * what the app *asked* to show — including the tags that keep the two kinds separate.
 */
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";

interface Shown {
  title: string;
  body?: string;
  tag?: string;
}

/** Install a recording Notification double BEFORE any app code runs. */
async function stubNotifications(
  page: Page,
  { permission = "granted", enabled = true }: { permission?: string; enabled?: boolean } = {},
): Promise<void> {
  await page.addInitScript(
    ({ permission, enabled }) => {
      const shown: Shown[] = [];
      // Persist the granted state like a real browser does, so it survives a reload —
      // addInitScript re-runs on every navigation and would otherwise reset it.
      const KEY = "__fake_notification_permission";
      let current = localStorage.getItem(KEY) ?? permission;
      class FakeNotification {
        static get permission() {
          return current;
        }
        static async requestPermission() {
          current = "granted";
          localStorage.setItem(KEY, "granted");
          return "granted";
        }
        onclick: (() => void) | null = null;
        constructor(title: string, options?: NotificationOptions) {
          shown.push({ title, body: options?.body, tag: options?.tag });
        }
        close() {}
      }
      // @ts-expect-error - test double
      window.Notification = FakeNotification;
      // @ts-expect-error - test hook
      window.__notifications = shown;
      if (enabled) localStorage.setItem("tendto:notifications", "on");
    },
    { permission, enabled },
  );
}

async function shown(page: Page): Promise<Shown[]> {
  return page.evaluate(() => (window as unknown as { __notifications: Shown[] }).__notifications);
}

/** Sign up + open the app on a page that already has the stub installed. */
async function openApp(page: Page): Promise<void> {
  const user = makeUser();
  const res = await page.request.post(`${AUTH}/api/auth/sign-up/email`, {
    data: { email: user.email, password: user.password, name: user.name },
  });
  expect(res.ok(), `sign-up failed: ${res.status()}`).toBeTruthy();
  await page.goto("/");
  await expect(page.getByRole("button", { name: "New page" })).toBeVisible({ timeout: 30_000 });
}

/** A card due a minute ago, so it is already overdue for today. */
async function addCardDueNow(page: Page, title: string): Promise<void> {
  await page.getByRole("button", { name: "New collection" }).click();
  await page.getByRole("button", { name: "+ New item" }).click();
  const titleBox = page.getByTestId("detail-title");
  await titleBox.fill(title);
  await titleBox.press("Enter");
  await page.getByTestId("item-detail").waitFor();

  const now = new Date(Date.now() - 60_000);
  const pad = (n: number) => String(n).padStart(2, "0");
  await page
    .getByTestId("detail-due-date")
    .fill(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
  await page.getByTestId("detail-due-time").fill(`${pad(now.getHours())}:${pad(now.getMinutes())}`);
  // Close the detail: it is a full-screen overlay, so leaving it open blocks the board and the
  // sidebar for whatever the test does next.
  await page.getByRole("button", { name: "Close card" }).click();
  await expect(page.getByTestId("board-card").first()).toContainText(title);
}

/** Nudge the watcher the way returning to the tab does, then count matching notifications. */
async function countAfterNudge(page: Page, needle: string): Promise<number> {
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  return (await shown(page)).filter((n) => n.title.includes(needle)).length;
}

test.describe("notifications", () => {
  test("the toggle reports Blocked when the browser denies notifications", async ({
    authedPage: page,
  }) => {
    // Headless Chromium denies by default — the real browser-blocked case. The row must say
    // so rather than pretending it can notify.
    const toggle = page.getByTestId("notification-toggle");
    await expect(toggle).toContainText("Blocked");
    await expect(toggle).toBeDisabled();
  });

  test("nothing is enabled until the user opts in", async ({ page }) => {
    // Permission not yet asked ("default") and no stored choice.
    await stubNotifications(page, { permission: "default", enabled: false });
    await openApp(page);

    const toggle = page.getByTestId("notification-toggle");
    await expect(toggle).toContainText("Off");

    await toggle.click();
    await expect(toggle).toContainText("On");

    // Per-device, and it survives a reload.
    await page.reload();
    await expect(page.getByTestId("notification-toggle")).toContainText("On", { timeout: 30_000 });

    // Can be silenced again without touching browser settings.
    await page.getByTestId("notification-toggle").click();
    await expect(page.getByTestId("notification-toggle")).toContainText("Off");
  });

  test("an item due now fires exactly one reminder", async ({ page }) => {
    await stubNotifications(page);
    await openApp(page);
    await expect(page.getByTestId("notification-toggle")).toContainText("On");

    const title = `due-${Date.now().toString(36)}`;
    await addCardDueNow(page, title);

    await expect
      .poll(() => countAfterNudge(page, title), {
        timeout: 30_000,
        message: "expected a due reminder",
      })
      .toBe(1);

    // Repeated nudges (tab focus, the interval) must not re-notify for the same due value.
    for (let i = 0; i < 5; i++) await countAfterNudge(page, title);
    expect(await countAfterNudge(page, title)).toBe(1);

    // Nor may a reload. The recorder is per-page, so after reloading it starts empty —
    // ZERO here is the assertion that the persisted "already told you" set held.
    await page.reload();
    await expect(page.getByRole("button", { name: "New collection" })).toBeVisible({
      timeout: 30_000,
    });
    await page.waitForTimeout(1500);
    expect(await countAfterNudge(page, title)).toBe(0);
  });

  test("a done item does not nag", async ({ page }) => {
    await stubNotifications(page);
    await openApp(page);

    const title = `done-${Date.now().toString(36)}`;
    await addCardDueNow(page, title);
    // Move it to the board's LAST column, which is what "done" means here. The table's status
    // select is the least racy way to do that (the checklist checkbox round-trips through the
    // replica before React re-renders it).
    await page.getByRole("button", { name: "Table" }).click();
    await page.getByTestId("table").locator("select").first().selectOption("done");
    await expect(page.getByTestId("table").locator("select").first()).toHaveValue("done");

    await page.waitForTimeout(500);
    expect(await countAfterNudge(page, title)).toBe(0);
  });

  test("reminders stay silent while notifications are off", async ({ page }) => {
    await stubNotifications(page, { permission: "granted", enabled: false });
    await openApp(page);
    await expect(page.getByTestId("notification-toggle")).toContainText("Off");

    const title = `quiet-${Date.now().toString(36)}`;
    await addCardDueNow(page, title);

    await page.waitForTimeout(1000);
    expect(await countAfterNudge(page, title)).toBe(0);
  });

  test("the Pomodoro notifies on its own tag when a phase ends", async ({ page }) => {
    await stubNotifications(page);
    // A work phase that has already elapsed, so completion fires on load.
    await page.addInitScript(() => {
      localStorage.setItem(
        "tendto-focus",
        JSON.stringify({
          state: {
            phase: "work",
            running: true,
            endsAt: Date.now() - 1000,
            pausedRemaining: 0,
            completed: 0,
            workMin: 25,
            breakMin: 5,
            tasks: [],
          },
          version: 0,
        }),
      );
    });
    await openApp(page);
    await page.getByRole("button", { name: "Focus" }).click();
    await expect(page.getByTestId("focus-timer")).toBeVisible({ timeout: 30_000 });

    await expect
      .poll(async () => (await shown(page)).filter((n) => n.tag === "tendto-pomodoro").length, {
        timeout: 30_000,
        message: "expected a Pomodoro notification",
      })
      .toBeGreaterThan(0);

    const pomodoro = (await shown(page)).find((n) => n.tag === "tendto-pomodoro");
    expect(pomodoro?.title).toContain("Focus session complete");
    // A tag of its own, so a due reminder can't replace it in the OS (and vice versa).
    expect(pomodoro?.tag).not.toContain("tendto-due");
  });
});
