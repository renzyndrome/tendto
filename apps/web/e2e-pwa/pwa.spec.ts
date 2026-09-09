/**
 * The installable PWA: manifest, icons, service worker, and an offline cold boot.
 *
 * This is the spec behind "install it on my phone". Chrome only offers a real "Install app" if
 * the manifest is reachable and has an icon of at least 192px AND a service worker with a fetch
 * handler is controlling the page; a cold boot with no network only works if the bundle and the
 * SQLite wasm were precached. Each of those is asserted below, against a production build.
 *
 * No backend runs here — see playwright.pwa.config.ts.
 */
import { expect, test } from "@playwright/test";

/** The sign-in screen: what an unauthenticated cold boot must render. */
function signInHeading(page: import("@playwright/test").Page) {
  return page.getByRole("heading", { name: "TendTo" });
}

test.describe.configure({ mode: "serial" });

test("the app installs a service worker and precaches its shell", async ({ page }) => {
  await page.goto("/");
  await expect(signInHeading(page)).toBeVisible({ timeout: 30_000 });

  // Registration is ours (src/lib/pwa.ts), not the plugin's injected script.
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Workbox stores precache entries with a __WB_REVISION__ query, hence ignoreSearch.
  const precached = await page.evaluate(async () => {
    const names = await caches.keys();
    for (const name of names) {
      const cache = await caches.open(name);
      const shell = await cache.match("/index.html", { ignoreSearch: true });
      if (!shell) continue;
      const entries = await cache.keys();
      return {
        cache: name,
        // The SQLite wasm is ~2.5 MB and sits above workbox's default 2 MiB limit; if the
        // limit regressed, the app would still install but never open offline.
        wasm: entries.filter((request) => request.url.endsWith(".wasm")).length,
      };
    }
    return null;
  });

  expect(precached, "no cache contains the app shell").not.toBeNull();
  expect(precached!.wasm, "the SQLite wasm must be precached or offline boot fails").toBeGreaterThan(0);
});

test("the web manifest is installable: icons, scope, and theme", async ({ page }) => {
  await page.goto("/");

  const manifestLink = page.locator('link[rel="manifest"]');
  await expect(manifestLink).toHaveCount(1);

  const href = await manifestLink.getAttribute("href");
  const response = await page.request.get(href!);
  expect(response.ok()).toBe(true);

  const manifest = (await response.json()) as {
    name: string;
    start_url: string;
    display: string;
    icons: { src: string; sizes: string; type: string; purpose?: string }[];
  };

  expect(manifest.name).toBe("TendTo");
  expect(manifest.display).toBe("standalone");
  expect(manifest.start_url).toBe("/");

  // Chrome's installability bar: an icon >= 192px, plus a maskable one so Android does not
  // paste the square PNG onto a white blob.
  expect(manifest.icons.length).toBeGreaterThanOrEqual(2);
  const sizes = manifest.icons.map((icon) => Number.parseInt(icon.sizes, 10));
  expect(Math.max(...sizes)).toBeGreaterThanOrEqual(512);
  expect(sizes.some((size) => size >= 192)).toBe(true);
  expect(manifest.icons.some((icon) => icon.purpose?.includes("maskable"))).toBe(true);

  // Every icon must actually be served — a 404 here is invisible until install time.
  for (const icon of manifest.icons) {
    const iconResponse = await page.request.get(new URL(icon.src, new URL(href!, page.url())).toString());
    expect(iconResponse.ok(), `${icon.src} is not served`).toBe(true);
  }

  await expect(page.locator('meta[name="theme-color"]').first()).toHaveCount(1);
  await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveCount(1);
});

test("the app cold-boots with the network off", async ({ page, context }) => {
  await page.goto("/");
  await expect(signInHeading(page)).toBeVisible({ timeout: 30_000 });
  await page.evaluate(() => navigator.serviceWorker.ready);

  // Kill the network, then reload: everything must come from the service worker's precache.
  // This is the phone-in-a-tunnel case, and the reason the wasm assertion above matters.
  await context.setOffline(true);
  try {
    await page.reload();
    await expect(signInHeading(page)).toBeVisible({ timeout: 30_000 });
  } finally {
    await context.setOffline(false);
  }
});
