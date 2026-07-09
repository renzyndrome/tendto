# 05 — Database & Multi-Tenancy (TendTo as a public SaaS)

Opening TendTo to the public — where users create a **personal** space *or* a **company group** —
turns it into a **multi-tenant SaaS**. This doc defines the data stores, the tenancy model, and how
isolation is enforced. Consistent with the sync-engine plan in
[doc 02](./02-architecture-and-stack.md).

## 1. Three stores

| Layer | What it stores | Tech |
| --- | --- | --- |
| **On each device** | A replica of the workspaces the user belongs to — for instant, offline reads/writes | **SQLite** via the PowerSync client (wasm/OPFS on web; native SQLite in future shells) |
| **Primary database** | The source of truth: users, orgs, workspaces, memberships, pages, **blocks**, collections, **items**, comments, settings, billing | **Postgres** |
| **Object storage** | Images, file attachments, large media | S3-compatible (MinIO self-hosted, or a cloud bucket) |

**Postgres is the single source of truth; the device replicas are projections of it.** Content is
relational — `blocks` (typed JSON content, ordered per page) and `items` (JSONB properties) — which
keeps server-side search, exports, and the AI summary plain SQL, and keeps the sync engine
swappable (plain rows, no proprietary blobs). Add **pgvector** in the same instance for semantic
search later.

### Where to host Postgres

- **Supabase (recommended to start)** — managed Postgres + **RLS** + storage bundled, a self-host
  path (keeps the no-lock-in promise credible), and **first-class PowerSync integration** — the
  pairing is well-documented, which matters more than raw feature lists. Use it as managed Postgres
  while Clerk owns auth.
- **Neon (solid alternative)** — serverless Postgres with branching for preview environments. Its
  scale-to-zero economics fit this architecture well (reads never hit the server; Postgres works
  only on writes and sync), but verify logical-replication support fits PowerSync's needs on your
  plan.
- **Plain managed Postgres on a VPS/RDS** — the boring self-host endgame; reachable from either of
  the above since it's all just Postgres.

## 2. The tenancy model — personal *and* company

```
User ──< Membership(role) >── Organization        ← a "company group" (billing + members)
                                   │
                                   ├──< Workspace        ← a sidebar of content
Personal user ───────────────────►├──< Workspace        ← a personal workspace = just you
                                          │
                                          ├──< Page ──< Block
                                          └──< Collection ──< Item
```

- **Personal account** — on signup the user gets a private **personal workspace**.
- **Company group** — a user creates an **Organization**, invites teammates as members with roles.
- **Roles** — owner / admin / member at the org level; editor / commenter / viewer at the
  workspace level.

Entities: `users`, `organizations`, `workspaces`, `memberships`, `pages`, `blocks`, `collections`,
`items`, `comments`, `invitations`, plus billing tables.

### Isolation — enforced at three layers

Tenancy has two flows, and each has a boundary, with RLS as the backstop behind both:

1. **Download (what reaches a device):** PowerSync **Sync Rules** bucket data per workspace and
   only sync buckets the authenticated user is a member of. A device never receives a byte of a
   workspace it doesn't belong to. This is the moral equivalent of the old design's
   `onAuthenticate` hook — but declarative, in one reviewed file. One honest CRDT-era lesson still
   applies: **once data has synced to a device, it's on that device** — revoking access stops
   future sync; plan on it, don't fight it.
2. **Upload (what gets written):** every queued write lands in **FastAPI**, which checks
   membership + role before touching Postgres. Malicious or stale clients can't write around it.
3. **Backstop:** a `tenant_id` (`org_id`/`workspace_id`) column on every tenant-scoped row +
   **Postgres Row-Level Security** — the standard B2B-SaaS pattern — so even a bug in layers 1–2
   can't leak rows across tenants.

Keep heavier isolation (schema- or database-per-tenant) in reserve for enterprise customers who
demand hard separation.

## 3. Auth — don't roll your own for a public app

- **Clerk (recommended to start)** — ships an **Organizations** product with prebuilt invite /
  org-switcher / role UI, so "personal or company group" is largely solved out of the box. Clerk's
  JWTs also authenticate the PowerSync client (the engine validates the token, sync rules read the
  user id from it). Watch per-active-user pricing as you grow.
- **WorkOS (AuthKit)** — free up to 1M MAU; **SSO/SCIM** is its core. Add when selling to companies
  that demand enterprise sign-in.
- **Auth0** — general-purpose; multi-tenant authorization tends to stay application-owned.

## 4. "Open to the public" — the newly required pieces

- **Managed auth** (Clerk/WorkOS) — never hand-roll for a public app.
- **Transactional email** (Resend/Postmark) — invites, verification, daily AI summary delivery.
- **Billing** (Stripe) — per-seat for company groups; free personal tier.
- **Backups + point-in-time recovery** — included with Supabase/Neon; verify restores. (Device
  replicas are *not* backups — they're evictable caches.)
- **Data export** — full workspace export (JSON + Markdown) reinforces "you own your data"
  (doc 01 §4); one SQL pass.
- **Rate limiting + abuse prevention** on open signup (including upload-queue abuse);
  **GDPR**-style deletion/export — deletion must also stop sync and expire buckets.

## 5. One-paragraph summary

**Postgres is the source of truth; every device carries a SQLite projection of it.** Host Postgres
on **Supabase** to launch (first-class PowerSync pairing; Neon or plain managed Postgres are
drop-in later), with **S3-compatible** object storage and **pgvector** in the same instance. Model
tenancy as **User → Membership(role) → Workspace**, with an **Organization** wrapping workspaces
for company groups. Enforce isolation three times: **sync rules** gate what flows *down* to
devices, **FastAPI** gates every write flowing *up*, and `tenant_id` + **RLS** backstop both in the
database. Use **Clerk** for orgs/auth (its JWTs double as sync-engine credentials) and add the
public-SaaS essentials (email, Stripe, backups, export, rate limiting) as you go.

## Sources

- [Supabase vs Neon (serverless Postgres, 2026)](https://getautonoma.com/blog/supabase-vs-neon) · [Neon vs Supabase 2026](https://tech-insider.org/neon-vs-supabase-2026/) · [Supabase RLS best practices for multi-tenant apps](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) · [Row-Level Security in Postgres (2026)](https://suparbase.com/blog/row-level-security-postgres-2026)
- [PowerSync: offline-first sync for Postgres](https://queryplane.com/blog/powersync-offline-first-sync/) · [ElectricSQL vs PowerSync vs Zero (2026)](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026)
- [WorkOS vs Auth0 vs Clerk for B2B SaaS (2026)](https://workos.com/blog/workos-vs-auth0-vs-clerk-the-best-auth-platform-for-b2b-saas-in-2026)
