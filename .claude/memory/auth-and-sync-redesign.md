---
name: auth-and-sync-redesign
description: Why Clerk was dropped for better-auth and PowerSync was kept (2026-07-09)
metadata:
  type: project
---

2026-07-09 redesign, requested by Renzy ("Clerk's scale pricing is ridiculous; PowerSync hinders
better-auth").

**Clerk → better-auth (self-hosted).** Clerk bills per retained user *plus* ~$1/org/month —
TendTo's shape (many small, often-free workspaces) hits the org meter hardest; ~$1k/mo at 100K
users before orgs. better-auth (v1.6+, org + JWT plugins) gives orgs/invites/roles/teams and a
JWKS endpoint at zero marginal cost, with auth tables in our own Postgres. It runs as a tiny
Hono-on-Bun service in `apps/auth` (:3001) — the sanctioned amendment to "no Node services" in
[[settled-decisions]]: infrastructure like the PowerSync container, never business logic.

**PowerSync kept.** The "hindrance" was config, not structure: PowerSync verifies any JWT against
a configured JWKS URL and supports EdDSA — better-auth's default signing alg. Wiring: client
calls better-auth `GET /api/auth/token` (session cookie → 15-min JWT, under PowerSync's 60-min
ceiling); FastAPI and PowerSync both verify via `/api/auth/jwks`; `aud` must match on all three
(env `AUTH_AUDIENCE` = powersync `client_auth.audience`). No engine in the 2026 field replaces it
for the hard offline requirement: Electric = read-path only (no offline write queue; pivoted to
agents), Zero 1.0 rejects offline writes by design, Replicache archived, cr-sqlite dormant,
TanStack DB offline-transactions young/DIY. PowerSync self-host is free (FSL Open Edition).

**Why:** vendor auth pricing scales against a freemium many-workspace product; self-hosted auth +
JWKS keeps every service (API, sync) verifying the same stateless token.
**How to apply:** auth changes go in `apps/auth` config only; anything needing user identity
verifies the better-auth JWT via JWKS — never call the auth service per-request from FastAPI.
