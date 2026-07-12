import { expect, test as setup } from "@playwright/test";

/**
 * Health gate — fails fast (with a clear message) if the backend stack isn't up, so specs don't
 * flake with confusing errors. `make e2e` boots the stack via scripts/e2e-stack.sh first.
 */
const API = process.env.VITE_API_URL ?? "http://localhost:18000";
const AUTH = process.env.VITE_AUTH_URL ?? "http://localhost:13001";
const POWERSYNC = process.env.VITE_POWERSYNC_URL ?? "http://localhost:18080";

setup("backend stack is healthy", async ({ request }) => {
  await expect
    .poll(async () => (await request.get(`${API}/health`)).status(), {
      timeout: 30_000,
      message: `FastAPI not reachable at ${API} — run \`make e2e-stack\``,
    })
    .toBe(200);
  await expect
    .poll(async () => (await request.get(`${AUTH}/health`)).status(), {
      message: `better-auth not reachable at ${AUTH} — run \`make e2e-stack\``,
    })
    .toBe(200);
  await expect
    .poll(async () => (await request.get(`${POWERSYNC}/probes/readiness`)).status(), {
      message: `PowerSync not ready at ${POWERSYNC} — run \`make e2e-stack\``,
    })
    .toBe(200);
});
