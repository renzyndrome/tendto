# Page folders (2026-10-07): a folder is a pages row, not a table

Folders group pages in the sidebar, worked like an editor's file explorer (highlight a row, then
"New page" / "New folder" create inside the highlighted folder; drag rows in and out).

## One column, not a second tree

A folder is `pages.kind = 'folder'` (migration 0009). It reuses `parent_id` nesting, the delete
cascade, the `workspace_content` bucket and the upload allowlist. A `folders` table would have
needed a second parent pointer on pages, its own sync rules and a two-table move. Subpages still
work: a page can hold pages, a folder only groups them.

## Why `kind` is nullable with no CHECK

A PowerSync PUT carries every column, nulls included, and the upload queue is ordered. A NOT
NULL or CHECK violation would 500 and wedge that device's writes for good (same trap as the
timestamp bind in [[focus-gamification]]). So the rule lives in the readers: anything but
`'folder'` is a page. Rows synced before 0009 read NULL on the device, because ADD COLUMN with
a default emits no WAL and PowerSync never resends them.

## Filters live at query time

Folders must stay out of search, the `[[` link menu, related pages, the recap and the Markdown
export. The FTS mirror (`fts_pages`) has no `kind` column, and adding one would need the virtual
table rebuilt on every device, so FTS queries filter with `id NOT IN (SELECT id FROM pages WHERE
kind = 'folder')` (`NOT_A_FOLDER_ID_SQL` in lib/pages.ts). A new reader of `pages` that means
"a page" must add the filter too.

## LWW can build trees no device wrote

Two devices moving folders into each other, or one deleting a folder while another moves a page
into it, leave loops and orphans after last-write-wins. `lib/page-tree.ts` shows such rows at
the top level so nothing vanishes, `movePage` refuses a drop into the row's own subtree, and
`deletePageCascade` tracks visited ids so a loop cannot hang it.

## Dev trap

The dev API started by `scripts/e2e-stack.sh` runs WITHOUT `--reload`. After a model change it
keeps the old column list, silently drops the new field from uploads (`_row_values` filters to
known columns), and the server copy then syncs back down over the client's value. Restart it.

## Collections got the same folders (2026-10-07, migration 0010)

`collections.parent_id` + `collections.kind` ('folder' | 'collection'), same nullable/no-CHECK
rule. Both sidebar sections now render through one component (`components/layout/sidebar-tree.tsx`
with a `TreeSource` per section) and one move helper (`lib/tree-moves.ts`). Only folders nest in
Collections; collections got a `position` in 0011 (see [[sidebar-tools]]). The reader that matters is the
calendar quick-create picker: a folder there would let a task be filed into something with no
board (`IS_COLLECTION_SQL`). `collections.name` is VARCHAR(200), so names are capped by code
point before upload; a `slice` could split an emoji and 500 the queue.
