/**
 * The sidebar's folder trees (Pages and Collections), built from flat rows. Pure functions, no
 * database access. A row is a folder when `kind = 'folder'`; anything else is an item.
 *
 * Rows arrive from a sync stream that resolves conflicts last-write-wins, so the tree has to
 * survive states no single device would write: a row whose parent was deleted on another
 * device, or two folders moved into each other at the same moment. Both would otherwise vanish
 * from the sidebar while still existing. Such rows are placed at the top level instead, so every
 * row shows exactly once.
 */

export interface TreeRow {
  id: string;
  title: string;
  parent_id: string | null;
  /** "folder", or the item's own kind / NULL (rows older than folders) for an item. */
  kind: string | null;
  position: number;
}

export interface Tree {
  byId: ReadonlyMap<string, TreeRow>;
  /** Children per parent id; `null` holds the top level. Folders first, then by position. */
  children: ReadonlyMap<string | null, readonly TreeRow[]>;
}

export function isFolder(row: TreeRow | undefined): boolean {
  return row?.kind === "folder";
}

/** The parent this row is SHOWN under: its own, unless that parent is missing or loops back. */
function placedParent(row: TreeRow, byId: ReadonlyMap<string, TreeRow>): string | null {
  if (row.parent_id === null || !byId.has(row.parent_id)) return null;
  const seen = new Set<string>([row.id]);
  let cursor = byId.get(row.parent_id);
  while (cursor) {
    if (seen.has(cursor.id)) return null; // a loop: no path from the top level reaches it
    seen.add(cursor.id);
    if (cursor.parent_id === null) break;
    cursor = byId.get(cursor.parent_id);
  }
  return row.parent_id;
}

function compareRows(a: TreeRow, b: TreeRow): number {
  const folderFirst = Number(isFolder(b)) - Number(isFolder(a));
  return folderFirst !== 0 ? folderFirst : a.position - b.position;
}

export function buildTree(rows: readonly TreeRow[]): Tree {
  const byId = new Map(rows.map((row) => [row.id, row]));
  const grouped = new Map<string | null, TreeRow[]>();
  for (const row of rows) {
    const parent = placedParent(row, byId);
    const list = grouped.get(parent) ?? [];
    list.push(row); // a local builder, never seen outside this function
    grouped.set(parent, list);
  }
  const children = new Map<string | null, readonly TreeRow[]>();
  for (const [parent, list] of grouped) {
    children.set(parent, [...list].sort(compareRows));
  }
  return { byId, children };
}

/** Every id shown inside `id`, at any depth. A drop onto any of them would make a loop. */
export function descendantIds(tree: Tree, id: string): Set<string> {
  const found = new Set<string>();
  const queue = [id];
  while (queue.length > 0) {
    const current = queue.shift() as string;
    for (const child of tree.children.get(current) ?? []) {
      if (found.has(child.id)) continue;
      found.add(child.id);
      queue.push(child.id);
    }
  }
  return found;
}

/**
 * Where "New …" / "New folder" put the new row, given the highlighted row (VS Code rule):
 * inside a highlighted folder, beside a highlighted item, at the top level when nothing is.
 */
export function createTarget(tree: Tree, selectedId: string | null): string | null {
  const row = selectedId === null ? undefined : tree.byId.get(selectedId);
  if (!row) return null;
  if (isFolder(row)) return row.id;
  return placedParent(row, tree.byId);
}

/** The ids above `id`, nearest first, as the tree shows them. Used to reveal a new row. */
export function ancestorIds(tree: Tree, id: string): string[] {
  const out: string[] = [];
  let row = tree.byId.get(id);
  while (row) {
    const parent = placedParent(row, tree.byId);
    if (parent === null || out.includes(parent)) break;
    out.push(parent);
    row = tree.byId.get(parent);
  }
  return out;
}

/** The parent a row is SHOWN under (null = top level), as the tree places it. */
export function shownParent(tree: Tree, id: string): string | null {
  const row = tree.byId.get(id);
  return row ? placedParent(row, tree.byId) : null;
}

/**
 * Every row the tree currently shows, top to bottom: open folders' children follow their
 * folder, collapsed ones are skipped. This is the order arrow keys walk.
 */
export function visibleOrder(tree: Tree, collapsed: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const walk = (parent: string | null): void => {
    for (const row of tree.children.get(parent) ?? []) {
      out.push(row.id);
      if (!collapsed.has(row.id)) walk(row.id);
    }
  };
  walk(null);
  return out;
}

/** Where a dragged row lands relative to the row under the pointer. */
export type DropPlace = "before" | "after" | "into";

/**
 * Which part of a row the pointer is over. Folders take a drop in their middle half; their top
 * and bottom quarters, and the two halves of an item, place the row before or after it.
 * `ratio` is the pointer's height inside the row, 0 at the top and 1 at the bottom.
 */
export function dropPlace(row: TreeRow, ratio: number): DropPlace {
  if (isFolder(row)) {
    if (ratio < 0.25) return "before";
    if (ratio > 0.75) return "after";
    return "into";
  }
  return ratio < 0.5 ? "before" : "after";
}

/**
 * The sibling order after dropping `dragId` before or after `overId`, or null when that drop
 * is not a reorder. Folders always sort above items, so a row only reorders among its own
 * kind; a folder let go beside an item (or the other way round) just joins that parent.
 */
export function reorderedSiblings(
  tree: Tree,
  dragId: string,
  overId: string,
  place: "before" | "after",
): string[] | null {
  const dragged = tree.byId.get(dragId);
  const over = tree.byId.get(overId);
  if (!dragged || !over || isFolder(dragged) !== isFolder(over)) return null;
  const parent = placedParent(over, tree.byId);
  const group = (tree.children.get(parent) ?? [])
    .filter((row) => isFolder(row) === isFolder(dragged) && row.id !== dragId)
    .map((row) => row.id);
  const at = group.indexOf(overId);
  if (at < 0) return null;
  group.splice(place === "before" ? at : at + 1, 0, dragId);
  return group;
}
