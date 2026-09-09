/**
 * Icon generation for the installable PWA. Run once with `npm run pwa-assets`; the generated
 * PNGs are COMMITTED under public/.
 *
 * Deliberately NOT wired into vite.config.ts (`pwaAssets: { config: true }`): that would pull
 * `sharp` — a native module — into every `vite build`, including the node:22-alpine Docker
 * build in apps/web/Dockerfile. Generating once and committing keeps the image build pure JS.
 */
import { defineConfig, minimal2023Preset } from "@vite-pwa/assets-generator/config";

export default defineConfig({
  preset: minimal2023Preset,
  images: ["public/logo.svg"],
});
