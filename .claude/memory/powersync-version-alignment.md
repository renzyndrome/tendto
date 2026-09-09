---
name: powersync-version-alignment
description: PowerSync JS packages must be pinned as a SET matched to the alpha Tauri plugin — only one @powersync/common may exist
metadata:
  type: project
---

Phase 4.1 (2026-09-09) upgraded the web app from `@powersync/web` 1.38.7 / `@powersync/react`
1.10.0 to the **2.x line**, and the pins are not "latest" by choice.

**The constraint.** `@powersync/tauri-plugin` (alpha, for the desktop shell) depends on
`@powersync/common` **2.0.0** and `@powersync/shared-internals` **1.1.0** as EXACT versions. A
second copy of `common` in the tree would give two `Schema`/`Table` classes, and PowerSync's
`instanceof` checks would fail at runtime — with a confusing error, not a build failure. So every
PowerSync package must resolve to one `common` and one `shared-internals`.

Working set (the only one that satisfies this):

| package | version | why |
| --- | --- | --- |
| `@powersync/web` | 2.1.0 | the only 2.x on common 2.0.0 + shared-internals 1.1.0 (2.2.0 moved to common 2.1.0) |
| `@powersync/react` | 2.0.0 | peers `common ^2.0.0`; **2.0.1 peers ^2.2.0** and npm refuses the install |
| `@powersync/common` | 2.0.0 | now a direct dep — schema.ts and the shared types import from here |
| `@powersync/tauri-plugin` | 0.0.6 | pins the two above exactly |

**The rule: bump all four together, then verify** —
`npm ls @powersync/common @powersync/shared-internals` must print exactly one version of each
(all others "deduped"). If npm ever fails to dedupe, add an `overrides` block. This is a
correctness gate, not hygiene.

**What the 2.x upgrade actually touched** (three files, nothing else):
- `AbstractPowerSyncDatabase` was **renamed `CommonPowerSyncDatabase`** and is now an interface —
  hits `powersync/client.ts` and `powersync/fts.ts`. This rename is not in the published
  "breaking changes" list; expect it anyway.
- `schema.ts` imports `column/Schema/Table` from `@powersync/common` (shared with the Tauri SDK).
- The default connection method flipped **WebSocket → HTTP**. All 99 E2E passed on HTTP against
  the dev stack and Traefik in prod, so no override was needed. If a buffering proxy ever breaks
  streaming, the fix is one argument: `db.connect(connector, { connectionMethod:
  SyncStreamConnectionMethod.WEB_SOCKET })`.

Nothing else moved: the `useQuery` call sites, `getAll/execute/writeTransaction`, and
`database: { dbFilename }` are unchanged. The removed hooks (`usePowerSyncQuery`,
`usePowerSyncWatchedQuery`, `usePowerSyncStatus`) were never used here.

See [[desktop-shell-plan]] for why the Tauri plugin dictates the pins.
