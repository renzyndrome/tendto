import type { Page } from "@playwright/test";

/**
 * Seed first-run onboarding as complete so the welcome-dialog modal never intercepts the clicks
 * every spec relies on. Must run BEFORE the page navigates (addInitScript applies on each load).
 * Used by the authedPage fixture and by any manually-created second-device context (sync tests).
 */
export async function seedOnboardingComplete(page: Page): Promise<void> {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "tendto:onboarding",
      JSON.stringify({ state: { welcomed: true, tourDone: true, tourStep: 0 }, version: 0 }),
    );
  });
}
