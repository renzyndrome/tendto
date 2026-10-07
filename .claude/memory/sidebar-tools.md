# Sidebar tools (2026-10-07): favorites, Undo, order, keys, daily notes

Built on the folder trees ([[page-folders]]). The non-obvious parts:

## Favorites are personal, and their ids are random
`favorites` (migration 0012) rides `user_private` and is in USER_OWNED_TABLES: which pages
someone starred must not reach teammates. Ids are random, NOT derived from the target: a derived
id collides across users, and a write to another user's row is a 403 that wedges the ordered
upload queue. Two devices starring one page make two rows; the UI shows the target once
(GROUP BY) and unstarring deletes every row for it.

## RLS for a table added after 0008
Migration 0008 builds its statements from `app/models/rls.py` AT UPGRADE TIME. Listing a later
table in `_USER_TABLES` makes a fresh database fail at 0008, before the table exists. Later
user tables go in `LATER_USER_TABLES` and get `user_table_rls()` from their own migration;
`all_rls_statements()` is what the test schema applies. Same rule for any future table.

## Undo is a delayed delete, not a restore
Deleting from the sidebar hides the rows and writes the delete after 6s
(`stores/pending-delete.ts`). A real delete cannot be undone: Postgres cascades a page's
comments from the FK. The window is cut short by a second delete, the tab hiding, or sign-out.
The confirm dialogs are gone; e2e tests that still register a dialog handler are harmless.

## Order and memory
`collections.position` (0011) lets collections reorder like pages; NULL rows sort as 0 in
creation order. A reorder rewrites positions 0..n-1 for ONE sibling group (folders and items
sort separately, folders first). Closed folders are remembered per device in localStorage
(`tendto:tree-collapsed:<section>`).

## Daily notes
`pages.journal_date` (YYYY-MM-DD, the device's local day). The "Daily notes" folder is found by
following the latest note's parent, not by name, so renaming it keeps it in use. A daily note's
date title was set by the app, so a blank one shows no comment box (PageDiscussion).
