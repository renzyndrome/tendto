/**
 * `page_links` — a device-local index of which page links to which.
 *
 * The twin of the FTS index next door, and built the same way: a plain SQLite table kept fresh
 * by triggers on PowerSync's internal `ps_data__blocks` storage, rebuilt from scratch at every
 * boot, dropped on sign-out. It is DERIVED data, never a source of truth and never synced —
 * every row can be recomputed from the blocks the replica already holds, so there is no table
 * to migrate, no sync rule to write, and nothing extra for another device to reconcile.
 *
 * Trigger bodies must NEVER throw: a failing trigger aborts the write that fired it, and these
 * fire for rows applied by the sync stream as well as for local edits. Every nested-JSON read
 * is therefore guarded, and a block whose content is not valid JSON simply contributes no links.
 *
 * If setup fails, `isPageLinksReady()` stays false and the connections panel renders nothing,
 * exactly as it does for a page that genuinely has no links.
 */
import type { CommonPowerSyncDatabase } from "@powersync/common";

import { PAGE_LINK_TYPE } from "../../components/editor/page-link";

let ready = false;

/** Whether the link index was built, i.e. whether backlink queries can be trusted. */
export function isPageLinksReady(): boolean {
  return ready;
}

/**
 * The rows one or more block rows contribute, as SQL.
 *
 * `data` is an expression yielding a block row's JSON and `id` the matching block id: `NEW.data`
 * / `NEW.id` inside a trigger, or the columns of `ps_data__blocks` for the whole-table rebuild,
 * which is what `source` adds to the FROM clause.
 *
 * `json_tree` walks the inline-content tree, so a link is found however deeply it is nested. The
 * `CASE ... ELSE '[]'` is the never-throw guard. Item-description blocks are skipped: their
 * `page_id` is NULL, and a backlink has to come FROM a page for the panel to link back to it.
 */
function linkRowsSql(data: string, id: string, source = ""): string {
  return `
    SELECT json_extract(${data}, '$.workspace_id'),
           json_extract(${data}, '$.page_id'),
           json_extract(node.value, '$.props.pageId'),
           ${id}
    FROM ${source}json_tree(
      CASE WHEN json_valid(json_extract(${data}, '$.content'))
           THEN json_extract(${data}, '$.content') ELSE '[]' END) AS node
    WHERE node.type = 'object'
      AND json_extract(node.value, '$.type') = '${PAGE_LINK_TYPE}'
      AND json_extract(node.value, '$.props.pageId') IS NOT NULL
      AND json_extract(node.value, '$.props.pageId') != ''
      AND json_extract(${data}, '$.page_id') IS NOT NULL`;
}

const COLUMNS = "workspace_id, source_page_id, target_page_id, block_id";

const INTERNAL = "ps_data__blocks";

function setupStatements(): string[] {
  const internal = INTERNAL;
  return [
    `CREATE TABLE IF NOT EXISTS page_links (
       workspace_id TEXT NOT NULL,
       source_page_id TEXT NOT NULL,
       target_page_id TEXT NOT NULL,
       block_id TEXT NOT NULL
     )`,
    "CREATE INDEX IF NOT EXISTS page_links_target ON page_links(target_page_id)",
    "CREATE INDEX IF NOT EXISTS page_links_block ON page_links(block_id)",
    // Rebuild at every boot: idempotent, and it heals an index that drifted while its triggers
    // were absent (first run, or after sign-out dropped them).
    "DELETE FROM page_links",
    `INSERT INTO page_links(${COLUMNS}) ${linkRowsSql(
      `${internal}.data`,
      `${internal}.id`,
      `${internal}, `,
    )}`,
    `CREATE TRIGGER IF NOT EXISTS page_links_insert
       AFTER INSERT ON ${internal} BEGIN
         INSERT INTO page_links(${COLUMNS}) ${linkRowsSql("NEW.data", "NEW.id")};
       END`,
    // A block's links are replaced wholesale on every edit: cheaper to reason about than
    // diffing, and a block never has more than a handful of them.
    `CREATE TRIGGER IF NOT EXISTS page_links_update
       AFTER UPDATE ON ${internal} BEGIN
         DELETE FROM page_links WHERE block_id = OLD.id;
         INSERT INTO page_links(${COLUMNS}) ${linkRowsSql("NEW.data", "NEW.id")};
       END`,
    `CREATE TRIGGER IF NOT EXISTS page_links_delete
       AFTER DELETE ON ${internal} BEGIN
         DELETE FROM page_links WHERE block_id = OLD.id;
       END`,
  ];
}

/**
 * Build (or heal) the link index. Call once at boot, before the sync stream opens, so the
 * triggers are in place for the rows the first sync applies. Failure is non-fatal.
 */
export async function setupPageLinks(db: CommonPowerSyncDatabase): Promise<boolean> {
  try {
    for (const sql of setupStatements()) {
      await db.execute(sql);
    }
    ready = true;
  } catch (err) {
    console.error("page_links setup failed; the connections panel will stay empty", err);
    ready = false;
  }
  return ready;
}

/**
 * Sign-out teardown, for the same reason the replica itself is cleared: the index names one
 * account's pages. Triggers are dropped BEFORE the table — a trigger left pointing at a missing
 * table would abort the very writes that apply the next user's sync stream.
 */
export async function teardownPageLinks(db: CommonPowerSyncDatabase): Promise<void> {
  ready = false;
  try {
    for (const suffix of ["insert", "update", "delete"]) {
      await db.execute(`DROP TRIGGER IF EXISTS page_links_${suffix}`);
    }
    await db.execute("DROP TABLE IF EXISTS page_links");
  } catch (err) {
    // Never block sign-out on teardown; setup rebuilds from scratch at the next boot.
    console.error("Failed to drop page_links on sign out", err);
  }
}
