import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// wasm + topLevelAwait are required by @powersync/web (SQLite wasm).
export default defineConfig({
  // Read VITE_* from the repo-root .env (shared with api/auth)
  envDir: "../..",
  // Non-default port: other local projects use 5173
  server: { port: 15173, strictPort: true },
  // Modern target: the app already requires a modern browser (OPFS/wasm SQLite, top-level
  // await). It also avoids esbuild down-levelling the top-level-await wrapper to an older
  // target, which vite-plugin-top-level-await + esbuild 0.28 cannot transform.
  build: { target: "esnext" },
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // The PowerSync SQLite wasm (~2.5 MB) and app bundle exceed workbox's default 2 MiB
        // precache limit. They MUST be precached for the app to open offline.
        maximumFileSizeToCacheInBytes: 5 * 1024 * 1024,
      },
      manifest: {
        name: "TendTo",
        short_name: "TendTo",
        description: "Tend to your tasks, notes, and life.",
        theme_color: "#ffffff",
        display: "standalone",
      },
    }),
  ],
  worker: { format: "es" },
  optimizeDeps: {
    // PowerSync web worker needs these excluded from prebundling
    exclude: ["@powersync/web"],
  },
});
