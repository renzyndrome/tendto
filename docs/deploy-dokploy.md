# Deploying TendTo to a VPS with Dokploy

The whole stack ships as one Dokploy **Compose** service from `docker-compose.prod.yml`:
Postgres (internal only), PowerSync, the better-auth service, FastAPI, and the static web
bundle behind nginx. Dokploy's Traefik terminates HTTPS — required in production, since the
web app's OPFS storage (PowerSync's SQLite) only works in a secure context.

## One-time setup

1. **Push the repo** to GitHub/GitLab (Dokploy pulls from git).
2. In Dokploy: **Create Service → Compose**, point it at the repo, branch `main`,
   compose path `docker-compose.prod.yml`.
3. **Environment tab** — set the variables from [.env.prod.example](../.env.prod.example):
   `POSTGRES_PASSWORD`, `AUTH_SECRET` (both `openssl rand -base64 32`), and the four public
   URLs (`WEB_URL`, `API_URL`, `AUTH_URL`, `POWERSYNC_URL`). Leave `WEB_ORIGINS` blank unless you
   need an extra browser origin: blank already allows `WEB_URL` plus the desktop shell's webview,
   and unlike the URLs it is read at runtime, so changing it is a **restart, not a rebuild**.
4. **Domains tab** — attach one domain per public service (Traefik issues certificates):

   | Domain (example)       | Service     | Port |
   | ---------------------- | ----------- | ---- |
   | `tendto.example`       | `web`       | 80   |
   | `api.tendto.example`   | `api`       | 8000 |
   | `auth.tendto.example`  | `auth`      | 3001 |
   | `sync.tendto.example`  | `powersync` | 8080 |

   These must match the env vars — `VITE_*` URLs are baked into the web bundle at build time,
   and `AUTH_URL` becomes the JWT issuer that FastAPI and PowerSync validate.
5. **Deploy**, then run these three once (Dokploy terminal on the VPS). They run inside the
   images you just built and need no network of their own:

   ```bash
   docker compose -f docker-compose.prod.yml run --rm auth bunx better-auth migrate --yes
   docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
   docker compose -f docker-compose.prod.yml exec -T db \
     psql -U tendto -d tendto -c "CREATE PUBLICATION powersync FOR ALL TABLES;"
   ```

   **Do not skip the third command.** No migration creates that publication. Without it the
   PowerSync container still starts and reports healthy, and the app still works on each device —
   it just never syncs between them. The only clue is a repeating line in the PowerSync logs:

   ```
   Replication error [PSYNC_S1141] Publication 'powersync' does not exist.
   ```

   `FOR ALL TABLES` also covers tables added later, so it is a genuine one-off. Re-running it
   errors with "already exists", which is harmless. Confirm it took with:

   ```bash
   docker compose -f docker-compose.prod.yml exec -T db \
     psql -U tendto -d tendto -tAc "select slot_name, active from pg_replication_slots"
   ```

   One active slot means replication is live.

## How the pieces authenticate in prod

- Tokens are minted by better-auth with `iss = AUTH_URL` (public) and `aud = tendto`.
- FastAPI and PowerSync fetch JWKS **internally** (`http://auth:3001/api/auth/jwks`) — the
  auth container never needs to be reachable from the other containers via the public URL.
- Postgres is only on the `internal` network; nothing exposes 5432.

## Install it on a phone (Android)

The web app is an installable PWA. This only works over HTTPS with a real domain — a laptop's
`localhost` is not reachable from a phone, which is why this section lives in the deploy doc.

1. Push to `main` and let Dokploy rebuild `web`. The icons and manifest are baked into the image;
   nginx serves `index.html`, `sw.js` and `manifest.webmanifest` with `Cache-Control: no-cache`,
   so a phone picks up the new service worker the next time it opens the app.
2. **Check installability from a desktop first** — it is far easier to debug. Chrome →
   `https://<your web domain>` → DevTools → Application:
   - *Manifest*: no installability warnings, all four icons render.
   - *Service Workers*: one worker, status **activated and is running**.
   If either is wrong, stop here — the phone will only offer a plain bookmark.
3. **Android Chrome** → open the same URL → ⋮ menu → **Install app**. If the menu only offers
   "Add to Home screen" and no install dialog appears, step 2 failed.
4. Launch from the home-screen icon. It should open standalone (no URL bar), with the TendTo icon
   on the splash. Sign in, create a page, type something.
5. **Prove it works offline**: turn on airplane mode, swipe the app away, reopen it. Your content
   is still there and still editable — it is being read from the device's own SQLite replica, and
   the shell itself came from the service worker's cache. Turn airplane mode off; the edit appears
   on your laptop within a few seconds.

`apps/web/e2e-pwa/pwa.spec.ts` asserts steps 2 and 5 automatically on every `make e2e`; steps 3-4
are the one part only a real phone can confirm.

### If the install option never appears
- The icons must be served: open `https://<domain>/pwa-512x512.png` directly.
- `start_url` and `scope` are `/`; serving the app from a subpath needs both changed in
  `apps/web/vite.config.ts` **and** a rebuild.
- Chrome caches a failed installability check for a while — reopen in a new tab after fixing.

## Redeploys & notes

- Push to `main` → Dokploy rebuilds changed images and redeploys. DB data persists in the
  `dbdata` volume.
- Changing any `*_URL` requires a web **rebuild** (build args), not just a restart.
- Later move to Supabase for Postgres: point `DATABASE_URL`/`AUTH_DATABASE_URL`/
  `PS_DATABASE_URI` at Supabase, drop the `db` service — everything else is unchanged.
- Back up the `dbdata` volume (Dokploy has scheduled DB backups; device replicas are caches,
  not backups).
