/**
 * The sidebar's page tree, built from flat `pages` rows. Pure functions, no database access.
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
  /** "folder", or "page" / NULL (rows older than folders) for a page. */
  kind: string | null;
  position: number;
}

export interface PageTree {
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

export function buildPageTree(rows: readonly TreeRow[]): PageTree {
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
export function descendantIds(tree: PageTree, id: string): Set<string> {
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
 * Where "New page" / "New folder" put the new row, given the highlighted row (VS Code rule):
 * inside a highlighted folder, beside a highlighted page, at the top level when nothing is.
 */
export function createTarget(tree: PageTree, selectedId: string | null): string | null {
  const row = selectedId === null ? undefined : tree.byId.get(selectedId);
  if (!row) return null;
  if (isFolder(row)) return row.id;
  return placedParent(row, tree.byId);
}

/** Where a drop onto `overId` puts the dragged row: into a folder, beside a page. */
export function dropTarget(tree: PageTree, overId: string): string | null {
  return createTarget(tree, overId);
}

/** The ids above `id`, nearest first, as the tree shows them. Used to reveal a new row. */
export function ancestorIds(tree: PageTree, id: string): string[] {
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
