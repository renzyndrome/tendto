import { defineConfig, devices } from "@playwright/test";

/**
 * PWA E2E — proves the app is installable and opens with no network.
 *
 * Deliberately a SEPARATE config from playwright.config.ts, for two reasons:
 *
 *  1. It must run against a PRODUCTION build served by `vite preview`. The service worker and
 *     the web manifest only exist after `vite build`; the dev server has neither, so the main
 *     suite (which runs `npm run dev`) structurally cannot cover this.
 *  2. It needs no backend at all. A fresh browser context has no session, so the app settles on
 *     the sign-in screen — which is exactly the shell an offline cold boot has to render.
 *
 * Its specs live in e2e-pwa/ rather than e2e/ because e2e/ is the main suite's testDir and
 * Playwright would otherwise pick them up there with the wrong webServer.
 */
const PWA_URL = process.env.PWA_WEB_URL ?? "http://localhost:15174";

export default defineConfig({
  testDir: "./e2e-pwa",
  outputDir: "./e2e-pwa/.artifacts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 1,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: PWA_URL,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        launchOptions: { args: ["--enable-features=StorageBuckets"] },
      },
    },
  ],
  webServer: {
    // Always a fresh build: a stale dist/ would silently test the previous manifest.
    command: "npm run build && npm run preview -- --port 15174 --strictPort",
    url: PWA_URL,
    // Never reuse: `vite preview` on a stale dist is exactly the false pass we are avoiding.
    reuseExistingServer: false,
    // `tsc -b && vite build` on a cold cache is slow; the wasm assets are large.
    timeout: 240_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
