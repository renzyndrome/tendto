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
   URLs (`WEB_URL`, `API_URL`, `AUTH_URL`, `POWERSYNC_URL`).
4. **Domains tab** — attach one domain per public service (Traefik issues certificates):

   | Domain (example)       | Service     | Port |
   | ---------------------- | ----------- | ---- |
   | `tendto.example`       | `web`       | 80   |
   | `api.tendto.example`   | `api`       | 8000 |
   | `auth.tendto.example`  | `auth`      | 3001 |
   | `sync.tendto.example`  | `powersync` | 8080 |

   These must match the env vars — `VITE_*` URLs are baked into the web bundle at build time,
   and `AUTH_URL` becomes the JWT issuer that FastAPI and PowerSync validate.
5. **Deploy**, then run the migrations once (Dokploy terminal on the VPS):

   ```bash
   docker compose -f docker-compose.prod.yml run --rm auth bunx @better-auth/cli migrate
   docker compose -f docker-compose.prod.yml run --rm api alembic upgrade head
   ```

## How the pieces authenticate in prod

- Tokens are minted by better-auth with `iss = AUTH_URL` (public) and `aud = tendto`.
- FastAPI and PowerSync fetch JWKS **internally** (`http://auth:3001/api/auth/jwks`) — the
  auth container never needs to be reachable from the other containers via the public URL.
- Postgres is only on the `internal` network; nothing exposes 5432.

## Redeploys & notes

- Push to `main` → Dokploy rebuilds changed images and redeploys. DB data persists in the
  `dbdata` volume.
- Changing any `*_URL` requires a web **rebuild** (build args), not just a restart.
- Later move to Supabase for Postgres: point `DATABASE_URL`/`AUTH_DATABASE_URL`/
  `PS_DATABASE_URI` at Supabase, drop the `db` service — everything else is unchanged.
- Back up the `dbdata` volume (Dokploy has scheduled DB backups; device replicas are caches,
  not backups).
