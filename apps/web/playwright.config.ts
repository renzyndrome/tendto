import { defineConfig, devices } from "@playwright/test";

/**
 * TendTo E2E — drives the real local-first loop: browser → SQLite replica (OPFS/wasm) →
 * PowerSync → FastAPI → Postgres → back. The backend stack (Postgres, PowerSync, better-auth,
 * FastAPI) must already be up on its dev ports — `make e2e` boots it via scripts/e2e-stack.sh;
 * Playwright only starts Vite here. See docs/e2e.md.
 *
 * Chromium only: PowerSync's wasm SQLite persists to OPFS, which needs a Chromium secure context
 * (localhost qualifies). Sync is asynchronous, so we lean on web-first retrying assertions with a
 * generous expect timeout rather than fixed sleeps.
 */
const WEB_URL = process.env.WEB_URL ?? "http://localhost:15173";

export default defineConfig({
  testDir: "./e2e",
  outputDir: "./e2e/.artifacts",
  fullyParallel: false, // shared Postgres; isolate via unique users, run serially for stability
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 15_000 }, // cross-device sync needs room to converge
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    baseURL: WEB_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "setup", testMatch: /global\.setup\.ts/ },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        // Persist OPFS across reloads within a test; a fresh context per test still isolates.
        launchOptions: { args: ["--enable-features=StorageBuckets"] },
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command: "npm run dev",
    url: WEB_URL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
