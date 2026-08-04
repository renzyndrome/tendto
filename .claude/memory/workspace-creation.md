---
name: workspace-creation
description: Why workspace create/delete and all sharing live in the API rather than the replica, plus the concurrent-bootstrap race it exposed
metadata:
  type: project
---

Added 2026-08-04 (workspace switcher + creation).

- **A workspace is the one content-shaped thing that CANNOT be a local write.** Every other
  create (page, collection, item, block) goes into the replica and rides the upload queue. A
  workspace can't: `sync.py::_assert_can_write` resolves the tenant for a `workspaces` entry as
  the row id itself, then requires an owner/editor membership on it — which by definition does
  not exist yet, so the insert 403s. The workspace and its owner membership must be created
  together, server-side, which is `POST /workspaces` (mirroring `/bootstrap`). Do not "fix" this
  by relaxing the upload check — that check is the upload tenancy boundary.
- **Consequence: creating a workspace requires connectivity.** It is deliberately not queued
  offline; `lib/workspaces.ts` surfaces the failure and the sidebar shows an error. Everything
  else in the app stays offline-first.
- **The id is still client-generated**, so the endpoint is replay-safe: an existing id owned by
  the caller returns the same row (200-equivalent), an existing id owned by someone ELSE returns
  409. Joining a workspace is an invite flow, never a side effect of guessing a UUID.
- **`/bootstrap` had a concurrency bug that only became visible once the UI listed every
  workspace.** It did check-then-insert with no serialisation, and the client calls it from a
  boot effect that React StrictMode double-invokes — so two in-flight requests each provisioned a
  workspace and every dev user ended up with two identical "My Workspace" rows. Invisible before,
  because the sidebar only ever queried the active workspace by id. Fixed with a per-user
  `pg_advisory_xact_lock(hashtext('bootstrap:' || user_id))` taken before the check; it releases
  at commit, so the second caller waits and then sees the first's membership. `test_bootstrap.py`
  has a 5-way concurrent test that fails (5 workspaces created) without the lock.
- **The active workspace is persisted per device** (`tendto:workspace` in localStorage) and
  `bootstrapWorkspaces()` only honours it if the user is still a member — otherwise a workspace
  they were removed from, or one left by another account on a shared device, would stick.

## Which workspace operations are local writes, and which aren't

The dividing line is "could a malicious client authorise this against itself?", not "is it
content?":

- **Rename = local write.** The row exists and the caller is already a member, so the upload
  path authorises it like any other edit. Instant and offline-capable.
- **Create = API.** No membership exists yet, so the upload check can never pass (above).
- **Delete = API, owner-only.** A local `DELETE FROM workspaces` *would* pass the upload check
  — `WRITE_ROLES` includes `editor` — so an editor could destroy the whole tenant. The endpoint
  also refuses to delete your last workspace, because `/bootstrap` would silently provision a
  fresh empty one and that reads as data loss.
- **Members + invitations = API.** Pure permission decisions.

## The replica is NOT authoritative about which workspaces are yours

Learned the hard way 2026-08-04. A local SQLite replica can hold `workspaces` rows the server
no longer agrees with — deleted while this device was offline, left by a previous account, or
(in dev) wiped by `make test`. Nothing ever tells a disconnected client to drop them: removals
arrive only as bucket updates. Symptoms were a duplicate "My Workspace" in the switcher and,
worse, a *stale workspace becoming active*, after which every workspace-scoped API call 404'd
and the settings dialog just said "Workspace not found" with no way out.

So: `POST /bootstrap` returns the authoritative id list, it is held in `useUiStore.knownWorkspaceIds`,
and anything that lists or counts workspaces filters against it. `null` means "unknown"
(offline) — fall back to the replica, never treat it as "none". Two further guards:
- Boot only reopens the remembered workspace if it's in that list.
- A 404 from the members endpoint means "not ours" → re-run bootstrap and switch, rather than
  rendering an error. Never resolve this by deleting local rows: local deletes generate CRUD
  entries and would upload real deletions.

## Invitations (added 2026-08-04)

- **Owned by FastAPI, NOT better-auth's organization plugin** — despite doc 05/07 naming that
  plugin for "orgs/invites". Its invitations are scoped to an `organizationId`, but tenancy here
  is `memberships(user, workspace, role)` and `workspaces` has no `org_id` yet, so using it would
  mean one better-auth org per workspace AND workspace/role semantics inside `apps/auth` — which
  [[settled-decisions]] forbids ("FastAPI is the only product server… never app logic"). When
  Organizations land, the org plugin can own ORG membership while workspace membership stays in
  the API.
- **`workspace_invitations` is deliberately NOT synced** — it holds other people's email
  addresses and a bearer token. So the three-place rule does not apply to it; the settings panel
  reads it over the API. Same reason member emails come from the API: membership rows sync, but
  only as opaque better-auth user ids.
- **Acceptance is bound to the invited address, not to the link.** The server compares the
  signed-in account's email to the invitation's, so a forwarded/leaked link grants nothing. An
  e2e test covers exactly this.
- **Email uses the same contract as the AI provider**: empty `EMAIL_API_KEY` ⇒ `ConsoleProvider`,
  which logs instead of sending and reports `delivered=false`; the endpoint then returns
  `invite_url` and the UI shows a copyable link. Dev and the whole test suite stay network-free,
  and a failed real send degrades to the same copy-link path rather than losing the invite.
- **Invite emails are validated by syntax, not by `EmailStr`.** pydantic's `EmailStr` rejects
  RFC 2606 special-use domains (`.test`, `.invalid`) — which would break the e2e users and any
  self-hoster on `.internal`/`.local`. Deliverability is the mail provider's problem.

See [[phase-1-build]] for the `/bootstrap` chicken-and-egg this builds on.
