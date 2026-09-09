# TendTo auth service — better-auth on Hono + Bun
FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock* ./
# --ignore-scripts is deploy-critical, not hygiene. The better-auth CLI (a dependency, because
# migrations run from this image) pulls better-sqlite3, whose install script compiles C with
# node-gyp. This image is bun:1-slim — no node, no python, no compiler — so that build fails and
# takes the whole install down with it. We never touch SQLite here; Postgres is the only database.
RUN bun install --production --ignore-scripts

COPY src ./src

# better-auth schema migrations run as a deploy step, not at container start:
#   docker compose -f docker-compose.prod.yml run --rm auth bunx better-auth migrate --yes
# (the CLI is installed in the image, so this needs no network and cannot compile anything)
USER bun
EXPOSE 3001
CMD ["bun", "src/index.ts"]
