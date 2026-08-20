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
  pairing is well-documented, which matters more than raw feature lists. Use it as managed
  Postgres; better-auth's tables live in the same database (we skip Supabase Auth — see §3).
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

> **As built (2026-08-17).** `organizations` does not exist yet — `workspaces` has no `org_id`,
> and membership is workspace-level only. Two refinements landed with shared workspaces and card
> detail:
>
> - **`workspace_invitations`** is a first-class table owned by FastAPI (see doc 03, Phase 2
>   status, for why it is not better-auth's organization plugin). It is deliberately **not
>   synced** — it holds other people's email addresses and a bearer token, which have no business
>   on every member's device — so it is absent from `sync-rules.yaml` and the client schema, and
>   the settings panel reads it over the API.
> - **Not everything is workspace-scoped: `focus_sessions` (2026-08-18) is the first
>   USER-owned synced table.** The `workspace_content` bucket delivers every row of a workspace
>   to every member, so personal history carrying a `workspace_id` would land on teammates'
>   devices — irreversibly, per the one-way-door rule below. It carries `user_id` instead and
>   rides a second bucket, `user_private`, whose parameter query is just `request.user_id()`.
>   FastAPI gained the matching upload rule: user-owned tables authorize against the token
>   subject rather than `memberships`. The three isolation layers are unchanged in spirit — this
>   adds a second *tenant key*, not a second model.
> - **A third ownership shape: AUTHOR-owned rows inside a workspace bucket (`comments`,
>   2026-08-20).** The two shapes above are about *which bucket a row rides* — who receives it.
>   Comments raise the other question: everyone in the workspace should read the thread, but not
>   everyone should be able to rewrite a given line of it. So the download side is unchanged
>   (plain `workspace_content`, keyed on `workspace_id`) while the upload side narrows: after the
>   usual membership + role check, `sync.py` compares the row's **stored** `author_id` against the
>   token subject. Only the author may edit; a workspace owner may delete another member's comment
>   but never edit one. `author_id` is *pinned* on create exactly as `workspace_id` is, so a
>   client cannot post in someone else's name. The lesson worth keeping: **the bucket answers who
>   reads, the upload path answers who writes** — reaching for a new bucket to express a write
>   rule would have leaked the feature into the tenancy model.
> - **A block belongs to exactly one owner: a page *or* an item.** `blocks.page_id` became
>   nullable, `blocks.item_id` was added, and a CHECK enforces the XOR in the database (both
>   columns arrive from a client). A card's description is therefore the same primitive as a
>   page's body — same editor, same blocks, same sync path — rather than a parallel rich-text
>   column. The tree above becomes `Page ──< Block` **and** `Item ──< Block`.

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

## 3. Auth — self-hosted framework, because per-user pricing punishes this product

TendTo's shape — many small (often free) workspaces, every active user syncing daily — is exactly
the shape usage-priced auth vendors bill hardest. Clerk (the original pick, dropped 2026-07) bills
per retained user **plus ~$1/org/month** past its free tiers: roughly **$1k/mo at 100K users**
before the org meter, which grows with every two-person team. So auth is a self-hosted framework —
*not* hand-rolled crypto:

- **better-auth (chosen)** — open-source TypeScript auth framework; its tables live in **our own
  Postgres** (zero marginal cost per user, no vendor lock-in). The **organization plugin** covers
  organizations, email invitations, roles (owner/admin/member + custom), and teams — the Clerk
  Organizations equivalent. The **JWT plugin** exposes a JWKS endpoint and a `/token` endpoint:
  FastAPI and the PowerSync service both verify those JWTs statelessly, filling exactly the
  contract Clerk's JWTs used to fill (PowerSync officially supports custom JWKS issuers, including
  better-auth's default EdDSA keys). Runs as a tiny dedicated Bun service (`apps/auth`, Hono) —
  a deliberate, contained amendment to "no Node services": commodity infrastructure beside the
  PowerSync container, never product logic.
- **WorkOS (AuthKit)** — unchanged: add later when enterprise customers demand SSO/SCIM
  (per-connection pricing, only paid when an enterprise deal funds it).
- **Considered and not chosen:** Supabase Auth (cheapest, first-class PowerSync pairing, but no
  organization/invite primitive — we'd rebuild that layer anyway); Stack Auth (closest open-source
  Clerk clone, but younger and Next.js-centric); Zitadel/Keycloak (full IdPs — operationally
  overkill for this team size).

## 4. "Open to the public" — the newly required pieces

- **A real auth framework** (better-auth; WorkOS for enterprise SSO later) — never hand-roll
  crypto/sessions for a public app; self-hosting a framework is not hand-rolling.
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
database. Use **better-auth** for orgs/auth — self-hosted on the same Postgres, its JWTs double as
sync-engine credentials via JWKS — and add the public-SaaS essentials (email, Stripe, backups,
export, rate limiting) as you go.

## Sources

- [Supabase vs Neon (serverless Postgres, 2026)](https://getautonoma.com/blog/supabase-vs-neon) · [Neon vs Supabase 2026](https://tech-insider.org/neon-vs-supabase-2026/) · [Supabase RLS best practices for multi-tenant apps](https://makerkit.dev/blog/tutorials/supabase-rls-best-practices) · [Row-Level Security in Postgres (2026)](https://suparbase.com/blog/row-level-security-postgres-2026)
- [PowerSync: offline-first sync for Postgres](https://queryplane.com/blog/powersync-offline-first-sync/) · [ElectricSQL vs PowerSync vs Zero (2026)](https://trybuildpilot.com/648-electric-sql-vs-powersync-vs-zero-2026)
- [WorkOS vs Auth0 vs Clerk for B2B SaaS (2026)](https://workos.com/blog/workos-vs-auth0-vs-clerk-the-best-auth-platform-for-b2b-saas-in-2026)
