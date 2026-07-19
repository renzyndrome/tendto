/**
 * Collection mutations — create and delete (with items cascade). Item-level mutations live in
 * `lib/items/mutations.ts`. All writes go to the local replica; PowerSync uploads them.
 */
import type { Column } from "./items/mutations";
import { db } from "./powersync/client";

/**
 * Starting shape for a new collection. A collection is a Notion-style database (one items
 * primitive, four views); the template only seeds its initial view + columns — it's not a
 * separate type. "Blank" deliberately does NOT impose a to-do workflow (a board isn't always a
 * task list); "board" is the opinionated task template; "checklist" is a simple two-state list.
 */
export type CollectionTemplate = "blank" | "board" | "checklist";

interface TemplateShape {
  name: string;
  default_view: string; // checklist | list | table | board
  columns: Column[];
}

// Names are seeded EMPTY so the editor shows a placeholder (not literal text to delete); the
// sidebar/breadcrumb render "Untitled" via `name || "Untitled"`. Blank's column is likewise
// unnamed (placeholder "Column"); the task/checklist templates carry real, meaningful labels.
export const COLLECTION_TEMPLATES: Record<CollectionTemplate, TemplateShape> = {
  blank: { name: "", default_view: "board", columns: [{ id: "col", label: "" }] },
  board: {
    name: "",
    default_view: "board",
    columns: [
      { id: "todo", label: "To do" },
      { id: "doing", label: "In progress" },
      { id: "done", label: "Done" },
    ],
  },
  checklist: {
    name: "",
    default_view: "checklist",
    columns: [
      { id: "todo", label: "To do" },
      { id: "done", label: "Done" },
    ],
  },
};

/** Create a collection from a starting template (defaults to Blank). Returns the new id. */
export async function createCollection(
  workspaceId: string,
  template: CollectionTemplate = "blank",
): Promise<string> {
  const shape = COLLECTION_TEMPLATES[template];
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    `INSERT INTO collections (id, workspace_id, name, default_view, config, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      workspaceId,
      shape.name,
      shape.default_view,
      JSON.stringify({ columns: shape.columns }),
      now,
      now,
    ],
  );
  return id;
}

/** Delete a collection and all of its items. */
export async function deleteCollectionCascade(collectionId: string): Promise<void> {
  await db.writeTransaction(async (tx) => {
    await tx.execute("DELETE FROM items WHERE collection_id = ?", [collectionId]);
    await tx.execute("DELETE FROM collections WHERE id = ?", [collectionId]);
  });
}

// --- board columns (stored in collections.config) ------------------------------------------

/** A fresh board column with a unique id. Defaults to an EMPTY label so the header shows the
 *  "Column" placeholder to name — not literal text the user has to clear first. */
export function newColumn(label = ""): Column {
  return { id: crypto.randomUUID(), label };
}

/** Persist the board's column set on the collection. */
export async function setColumns(collectionId: string, columns: Column[]): Promise<void> {
  await db.execute("UPDATE collections SET config = ?, updated_at = ? WHERE id = ?", [
    JSON.stringify({ columns }),
    new Date().toISOString(),
    collectionId,
  ]);
}

/**
 * Delete a column and move its items to the first remaining column (never delete the last one).
 * Persists the reassigned items and the new column set in one pass.
 */
export async function deleteColumn(
  collectionId: string,
  columns: Column[],
  columnId: string,
): Promise<void> {
  const remaining = columns.filter((c) => c.id !== columnId);
  if (remaining.length === 0) return; // a board always keeps at least one column
  const fallback = remaining[0].id;

  const affected = await db.getAll<{ id: string; properties: string }>(
    "SELECT id, properties FROM items WHERE collection_id = ? AND json_extract(properties, '$.status') = ?",
    [collectionId, columnId],
  );
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    for (const row of affected) {
      let props: Record<string, unknown> = {};
      try {
        props = JSON.parse(row.properties) as Record<string, unknown>;
      } catch {
        props = {};
      }
      props.status = fallback;
      await tx.execute("UPDATE items SET properties = ?, updated_at = ? WHERE id = ?", [
        JSON.stringify(props),
        now,
        row.id,
      ]);
    }
  });
  await setColumns(collectionId, remaining);
}
