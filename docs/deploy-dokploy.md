# Deploying TendTo to a VPS with Dokploy

The whole stack ships as one Dokploy **Compose** service from `docker-compose.prod.yml`:
Postgres (internal only), PowerSync, the better-auth service, FastAPI, and the static web
bundle behind nginx. Dokploy's Traefik terminates HTTPS — required in production, since the
web app's OPFS storage (PowerSync's SQLite) only works in a secure context.

Production runs at **tendto.work**. The layout is one subdomain per public service:

| URL | Service | Port |
| --- | --- | --- |
| `https://tendto.work` | `web` | 80 |
| `https://api.tendto.work` | `api` | 8000 |
| `https://auth.tendto.work` | `auth` | 3001 |
| `https://sync.tendto.work` | `powersync` | 8080 |

All four share the registrable domain `tendto.work`, which is what lets the auth service's
SameSite=Lax session cookie reach it from the web app. Moving any one of them to an unrelated
domain would break sign-in in the browser.

## One-time setup

0. **DNS.** At the registrar for `tendto.work`, create four `A` records pointing at the
   droplet's public IPv4 address (and matching `AAAA` records if the droplet has IPv6 enabled):

   | Type | Name | Value |
   | --- | --- | --- |
   | `A` | `@` | droplet IPv4 |
   | `A` | `api` | droplet IPv4 |
   | `A` | `auth` | droplet IPv4 |
   | `A` | `sync` | droplet IPv4 |

   Check with `dig +short api.tendto.work` before deploying. Traefik requests the Let's Encrypt
   certificates over HTTP on port 80, so the droplet's firewall must allow 80 and 443, and the
   records must resolve first, or issuance fails and gets rate-limited.
1. **Push the repo** to GitHub/GitLab (Dokploy pulls from git).
2. In Dokploy: **Create Service → Compose**, point it at the repo, branch `main`,
   compose path `docker-compose.prod.yml`.
3. **Environment tab**: paste [.env.prod.example](../.env.prod.example), which already carries
   the four tendto.work URLs, then fill in the two secrets:
   `POSTGRES_PASSWORD` with `openssl rand -hex 32` and `AUTH_SECRET` with
   `openssl rand -base64 32`. **The Postgres password must be hex.** It is spliced into three
   connection URLs, and a base64 `/` ends the host part of each one early, which surfaces as
   a connection failure rather than as a bad password. Leave `WEB_ORIGINS` blank unless you
   need an extra browser origin: blank already allows `WEB_URL` plus the desktop shell's webview,
   and unlike the URLs it is read at runtime, so changing it is a **restart, not a rebuild**.
4. **Domains tab** — attach one domain per public service (Traefik issues certificates):

   | Domain              | Service     | Port |
   | ------------------- | ----------- | ---- |
   | `tendto.work`       | `web`       | 80   |
   | `api.tendto.work`   | `api`       | 8000 |
   | `auth.tendto.work`  | `auth`      | 3001 |
   | `sync.tendto.work`  | `powersync` | 8080 |

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

## Where AI runs in production

The server ships with **no AI engine**: `AI_API_KEY` is empty and `AI_CLI` is not passed
through at all, because a CLI on a shared host would be one person's subscription serving
everyone. What that means for each client:

| Client | AI |
| --- | --- |
| Desktop app | Runs on each user's own `claude` or `codex` CLI (see `docs/desktop.md`) |
| Browser and phone | No AI buttons. The recap still shows its facts |

Setting `AI_API_KEY` later turns AI on for the browser and phone too. It is read at runtime, so
that is a restart of the `api` service, not a rebuild.

## Desktop releases

The installers compile the backend URLs in. The repository's Actions **variables** (not secrets)
hold them:

| Variable | Value |
| --- | --- |
| `VITE_API_URL` | `https://api.tendto.work` |
| `VITE_AUTH_URL` | `https://auth.tendto.work` |
| `VITE_POWERSYNC_URL` | `https://sync.tendto.work` |

Check them with `gh variable list`. A release tagged before the backend is live still builds,
but the app it produces cannot sign anyone in until the backend answers at those addresses.

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
