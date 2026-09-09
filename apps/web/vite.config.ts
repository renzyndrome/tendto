import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// wasm + topLevelAwait are required by @powersync/web (SQLite wasm).
//
// `mode` is a function argument because the desktop (Tauri) build runs `--mode desktop`, which
// must NOT ship a service worker: the shell loads the bundle off disk, and a SW caching a
// tauri:// origin has nothing to serve and only gets in the way of updates.
export default defineConfig(({ mode }) => ({
  // Read VITE_* from the repo-root .env (shared with api/auth)
  envDir: "../..",
  // Non-default port: other local projects use 5173.
  //
  // The desktop build gets its OWN port, and that is not cosmetic. Playwright's webServer reuses
  // an existing server on 15173, so a `make desktop` session left running would silently serve
  // the DESKTOP bundle to the whole E2E suite — which then fails everywhere with
  // "Cannot read properties of undefined (reading 'invoke')" because Tauri's IPC is absent in a
  // browser. Separate ports make the two impossible to confuse.
  server: {
    port: mode === "desktop" ? 15175 : 15173,
    strictPort: true,
    // The Rust side of the desktop app is not part of the frontend graph; watching it makes
    // `cargo build`'s target/ churn restart Vite.
    watch: { ignored: ["**/src-tauri/**"] },
  },
  // Keep cargo's errors on screen during `tauri dev` (Vite otherwise clears the terminal).
  clearScreen: false,
  resolve: {
    alias: {
      // The ONE platform seam (src/lib/powersync/platform-contract.ts). Exactly one
      // implementation is compiled into a build: the browser bundle never carries Tauri code,
      // and the desktop bundle never carries the wasm SQLite worker.
      // tsconfig.json maps the same specifier to the web file so `tsc` has something to check.
      "@powersync-platform": fileURLToPath(
        new URL(
          mode === "desktop"
            ? "./src/lib/powersync/platform.desktop.ts"
            : "./src/lib/powersync/platform.web.ts",
          import.meta.url,
        ),
      ),
    },
  },
  // Modern target: the app already requires a modern browser (OPFS/wasm SQLite, top-level
  // await). It also avoids esbuild down-levelling the top-level-await wrapper to an older
  // target, which vite-plugin-top-level-await + esbuild 0.28 cannot transform.
  build: { target: "esnext" },
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      disable: mode === "desktop",
      registerType: "autoUpdate",
      // Registration is done by src/lib/pwa.ts instead of the plugin's injected script, so the
      // app can ask the SW to check for a new build on a long-lived installed instance.
      injectRegister: null,
      includeAssets: ["favicon.ico", "apple-touch-icon-180x180.png", "logo.svg"],
      workbox: {
        // The PowerSync SQLite wasm (~2.5 MB) and app bundle exceed workbox's default 2 MiB
        // precache limit. They MUST be precached for the app to open offline.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        id: "/",
        name: "TendTo",
        short_name: "TendTo",
        description: "Tend to your tasks, notes, and life.",
        start_url: "/",
        scope: "/",
        background_color: "#ffffff",
        theme_color: "#ffffff",
        display: "standalone",
        // Generated from public/logo.svg by `npm run pwa-assets` and committed. Chrome needs a
        // 192 and a 512 to offer "Install app"; the maskable one is what Android crops to its
        // icon shape without clipping the mark.
        icons: [
          { src: "pwa-64x64.png", sizes: "64x64", type: "image/png" },
          { src: "pwa-192x192.png", sizes: "192x192", type: "image/png" },
          { src: "pwa-512x512.png", sizes: "512x512", type: "image/png" },
          {
            src: "maskable-icon-512x512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
    }),
  ],
  worker: { format: "es" },
  optimizeDeps: {
    // PowerSync web worker needs these excluded from prebundling
    exclude: ["@powersync/web"],
  },
}));
