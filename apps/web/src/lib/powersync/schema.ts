/**
 * PowerSync client schema — MUST mirror the server tables that sync.
 * When you change a synced table, update all three together (see `sync-rules` skill):
 *   1. apps/api/app/models/core.py   (SQLAlchemy + Alembic migration)
 *   2. infra/powersync/sync-rules.yaml
 *   3. this file
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

const blocks = new Table(
  {
    workspace_id: column.text,
    page_id: column.text,
    type: column.text,
    content: column.text, // JSON string
    position: column.integer,
    created_at: column.text,
    updated_at: column.text,
  },
  { indexes: { by_page: ["page_id"] } },
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

export const AppSchema = new Schema({
  workspaces,
  memberships,
  pages,
  blocks,
  collections,
  items,
});

export type Database = (typeof AppSchema)["types"];
