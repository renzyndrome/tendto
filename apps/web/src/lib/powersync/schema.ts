/**
 * PowerSync client schema — MUST mirror the server tables that sync.
 * When you change a synced table, update all FOUR together (see `sync-rules` skill):
 *   1. apps/api/app/models/core.py   (SQLAlchemy + Alembic migration)
 *   2. infra/powersync/sync-rules.yaml
 *   3. this file
 *   4. `TABLE_MODELS` in apps/api/app/routers/sync.py — the upload allowlist, not just a
 *      dispatch map: a table missing from it is rejected with a 400.
 */
import { column, Schema, Table } from "@powersync/web";

const workspaces = new Table({
  name: column.text,
  created_at: column.text,
  updated_at: column.text,
});

const memberships = new Table(
  {
    user_id: column.text,
    workspace_id: column.text,
    role: column.text,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_workspace: ["workspace_id"] } },
);

const pages = new Table(
  {
    workspace_id: column.text,
    parent_id: column.text,
    title: column.text,
    position: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_workspace: ["workspace_id"] } },
);

// A block belongs to exactly one owner: a page, or an item's description (see the API model
// and migration 0004 — the XOR is enforced in Postgres).
const blocks = new Table(
  {
    workspace_id: column.text,
    page_id: column.text, // null for item descriptions
    item_id: column.text, // null for page bodies
    type: column.text,
    content: column.text, // JSON string
    position: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_page: ["page_id"], by_item: ["item_id"] } },
);

const collections = new Table(
  {
    workspace_id: column.text,
    name: column.text,
    default_view: column.text,
    config: column.text, // JSON string: per-collection view config (board columns)
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_workspace: ["workspace_id"] } },
);

const items = new Table(
  {
    workspace_id: column.text,
    collection_id: column.text,
    properties: column.text, // JSON string
    position: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_collection: ["collection_id"] } },
);

// A comment belongs to exactly one owner — a page or a card — the same XOR as blocks. `body` is
// plain text carrying inline `@[<user_id>:<label>]` mention tokens, and `author_label` is the
// author's display name denormalized at write time: user records live in better-auth and never
// sync, so without it a comment could not render offline.
const comments = new Table(
  {
    workspace_id: column.text,
    page_id: column.text, // null for card comments
    item_id: column.text, // null for page comments
    author_id: column.text,
    author_label: column.text,
    body: column.text,
    authored_at: column.text, // ISO timestamp from the writing device — what the thread sorts by
    edited_at: column.text, // ISO timestamp, null until the author edits
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_page: ["page_id"], by_item: ["item_id"] } },
);

// Focus sessions are USER-private, not workspace content: they ride their own user-scoped
// bucket (`user_private` in sync-rules.yaml), so there is deliberately no workspace_id here.
const focusSessions = new Table(
  {
    user_id: column.text,
    started_at: column.text, // ISO timestamp
    local_date: column.text, // YYYY-MM-DD in the USER's timezone (see the API model)
    minutes: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_date: ["local_date"] } },
);

export const AppSchema = new Schema({
  workspaces,
  memberships,
  pages,
  blocks,
  collections,
  items,
  comments,
  // Explicit key: Schema names each table from its object key, and the server table is
  // snake_case while the local const follows the file's camelCase convention.
  focus_sessions: focusSessions,
});

export type Database = (typeof AppSchema)["types"];
