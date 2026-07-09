import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import topLevelAwait from "vite-plugin-top-level-await";
import wasm from "vite-plugin-wasm";

// wasm + topLevelAwait are required by @powersync/web (SQLite wasm).
export default defineConfig({
  plugins: [
    react(),
    wasm(),
    topLevelAwait(),
    VitePWA({
      registerType: "autoUpdate",
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
