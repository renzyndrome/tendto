/**
 * SQLite FTS5 index over the local replica — the "instant search" upgrade from LIKE scans.
 *
 * Follows the official PowerSync full-text-search pattern: one `fts_<table>` virtual table per
 * searched table, kept fresh by AFTER INSERT/UPDATE/DELETE triggers on PowerSync's internal
 * `ps_data__<table>` storage (where a row's columns live as JSON in its `data` column). The
 * triggers fire both for local writes and for rows applied by the sync stream, so the index
 * needs no JS bookkeeping once it is set up.
 *
 * Trigger bodies must NEVER throw — a failing trigger aborts the write that fired it, which
 * would break sync apply. Every nested-JSON read is therefore guarded with `json_valid`.
 *
 * If FTS5 is unavailable or setup fails, `isFtsReady()` stays false and search falls back to
 * the original LIKE scans (see `../search.ts`).
 */
import type { AbstractPowerSyncDatabase } from "@powersync/web";

let ftsReady = false;

/** Whether the FTS index was built, i.e. whether search may use MATCH queries. */
export function isFtsReady(): boolean {
  return ftsReady;
}

/**
 * Plain text of a block's `content` JSON, in pure SQL: `json_tree` walks the inline-content
 * tree recursively and `key = 'text'` picks out the text nodes — the SQL twin of
 * `blockRowToText()`. `expr` is an expression yielding the row's `data` JSON.
 */
function blockTextSql(expr: string): string {
  return (
    `CASE WHEN json_valid(json_extract(${expr}, '$.content')) THEN ` +
    `(SELECT coalesce(group_concat(value, ' '), '') ` +
    `FROM json_tree(json_extract(${expr}, '$.content')) ` +
    `WHERE json_tree.key = 'text' AND json_tree.type = 'text') ` +
    `ELSE '' END`
  );
}

/** An item's title, out of the nested `properties` JSON string. Safe on garbage. */
function itemTitleSql(expr: string): string {
  return (
    `CASE WHEN json_valid(json_extract(${expr}, '$.properties')) THEN ` +
    `coalesce(json_extract(json_extract(${expr}, '$.properties'), '$.title'), '') ` +
    `ELSE '' END`
  );
}

/** A plain top-level text column. */
function plainSql(field: string): (expr: string) => string {
  return (expr) => `coalesce(json_extract(${expr}, '$.${field}'), '')`;
}

interface FtsTableSpec {
  /** Synced table name — also names `ps_data__<table>` and `fts_<table>`. */
  table: string;
  /** Stored-but-unindexed columns, copied so queries can filter on them. */
  unindexed: Record<string, (expr: string) => string>;
  /** Indexed (searchable) columns. */
  indexed: Record<string, (expr: string) => string>;
}

const SPECS: FtsTableSpec[] = [
  {
    table: "pages",
    unindexed: { workspace_id: plainSql("workspace_id") },
    indexed: { title: plainSql("title") },
  },
  {
    table: "items",
    unindexed: {
      workspace_id: plainSql("workspace_id"),
      collection_id: plainSql("collection_id"),
    },
    indexed: { title: itemTitleSql },
  },
  {
    // Item-description blocks are indexed too, but the search query filters them out
    // (`page_id IS NOT NULL`): a block hit navigates to a page, so a description is found via
    // its item instead. Filtering at query time rather than at index time means no row can be
    // left stale by an update that changes its owner.
    table: "blocks",
    unindexed: {
      workspace_id: plainSql("workspace_id"),
      page_id: plainSql("page_id"),
    },
    indexed: { body: blockTextSql },
  },
];

function setupStatements(spec: FtsTableSpec): string[] {
  const fts = `fts_${spec.table}`;
  const internal = `ps_data__${spec.table}`;

  const columns = [...Object.entries(spec.unindexed), ...Object.entries(spec.indexed)];
  const colList = ["id", ...columns.map(([name]) => name)].join(", ");

  const columnDefs = [
    "id UNINDEXED",
    ...Object.keys(spec.unindexed).map((name) => `${name} UNINDEXED`),
    ...Object.keys(spec.indexed),
  ].join(", ");

  const valuesFrom = (expr: string) =>
    columns.map(([, toSql]) => toSql(expr)).join(", ");

  const setFrom = (expr: string) =>
    columns.map(([name, toSql]) => `${name} = ${toSql(expr)}`).join(", ");

  return [
    `CREATE VIRTUAL TABLE IF NOT EXISTS ${fts}
       USING fts5(${columnDefs}, tokenize='unicode61')`,
    // Rebuild from the replica at every boot: idempotent, and it heals an index that drifted
    // while its triggers were absent (first run, or after sign-out dropped them).
    `DELETE FROM ${fts}`,
    `INSERT INTO ${fts}(rowid, ${colList})
       SELECT rowid, id, ${valuesFrom("data")} FROM ${internal}`,
    `CREATE TRIGGER IF NOT EXISTS ${fts}_insert
       AFTER INSERT ON ${internal} BEGIN
         INSERT INTO ${fts}(rowid, ${colList})
         VALUES (NEW.rowid, NEW.id, ${valuesFrom("NEW.data")});
       END`,
    `CREATE TRIGGER IF NOT EXISTS ${fts}_update
       AFTER UPDATE ON ${internal} BEGIN
         UPDATE ${fts} SET ${setFrom("NEW.data")} WHERE rowid = NEW.rowid;
       END`,
    `CREATE TRIGGER IF NOT EXISTS ${fts}_delete
       AFTER DELETE ON ${internal} BEGIN
         DELETE FROM ${fts} WHERE rowid = OLD.rowid;
       END`,
  ];
}

/**
 * Build (or heal) the FTS index. Call once at boot. Failure is non-fatal by design: search
 * silently stays on the LIKE fallback rather than the app losing search altogether.
 */
export async function setupFts(db: AbstractPowerSyncDatabase): Promise<boolean> {
  try {
    for (const spec of SPECS) {
      for (const sql of setupStatements(spec)) {
        await db.execute(sql);
      }
    }
    ftsReady = true;
  } catch (err) {
    ftsReady = false;
    console.error("FTS setup failed; search falls back to LIKE scans", err);
  }
  return ftsReady;
}

/**
 * Sign-out teardown, for the same reason the replica itself is cleared: the index holds copies
 * of one account's page titles and block text, so it must not outlive that account's session on
 * a shared device. Triggers are dropped BEFORE their tables — a trigger left pointing at a
 * missing table would abort the very writes that apply the next user's sync stream.
 */
export async function teardownFts(db: AbstractPowerSyncDatabase): Promise<void> {
  ftsReady = false;
  for (const spec of SPECS) {
    const fts = `fts_${spec.table}`;
    try {
      for (const suffix of ["insert", "update", "delete"]) {
        await db.execute(`DROP TRIGGER IF EXISTS ${fts}_${suffix}`);
      }
      await db.execute(`DROP TABLE IF EXISTS ${fts}`);
    } catch (err) {
      // Never block sign-out on teardown; `setupFts` rebuilds from scratch at the next boot.
      console.error(`Failed to drop ${fts} on sign out`, err);
    }
  }
}

/**
 * Turn user input into an FTS5 prefix query: each whitespace-separated term becomes a quoted
 * prefix token (`"budg"*`), so FTS operators typed by the user are inert. Returns null when
 * nothing searchable remains, in which case the caller should use the LIKE fallback.
 */
export function toPrefixQuery(input: string): string | null {
  const terms = input
    .split(/\s+/)
    .map((term) => term.replaceAll('"', ""))
    .filter((term) => term.length > 0);
  if (terms.length === 0) return null;
  return terms.map((term) => `"${term}"*`).join(" ");
}
