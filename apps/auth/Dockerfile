# TendTo auth service — better-auth on Hono + Bun
FROM oven/bun:1-slim

WORKDIR /app

COPY package.json bun.lock* ./
RUN bun install --production

COPY src ./src

# better-auth schema migrations run as a deploy step, not at container start:
#   docker compose -f docker-compose.prod.yml run --rm auth bunx @better-auth/cli migrate
USER bun
EXPOSE 3001
CMD ["bun", "src/index.ts"]
