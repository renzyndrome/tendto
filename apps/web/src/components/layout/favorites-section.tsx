/**
 * The sidebar's Favorites section: the pages and collections this user starred, in the order
 * they were starred, for the active workspace. Renders nothing until something is starred, so
 * a sidebar that never uses it never shows it.
 *
 * A favorite whose page or collection is gone (deleted, or in a workspace no longer synced) is
 * simply not listed: the join finds nothing. Rows waiting on a delete's Undo are hidden here
 * too, the same as in the trees.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";

import { removeFavorite } from "../../lib/favorites";
import { AUTO_TITLE } from "../../lib/pages";
import { useHiddenIds } from "../../stores/pending-delete";
import { idFromPath } from "./sidebar-tree";
import { StarIcon } from "./tree-icons";

interface FavoriteRow {
  id: string;
  kind: string;
  title: string;
}

export function FavoritesSection({ workspaceId }: { workspaceId: string | null }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const hidden = useHiddenIds();
  const openId = idFromPath(pathname, "p") ?? idFromPath(pathname, "c");

  // Two devices may each have starred the same target: GROUP BY shows it once.
  const { data } = useQuery<FavoriteRow>(
    `SELECT f.target_id AS id, f.target_kind AS kind,
            coalesce(p.title, c.name, '') AS title, MIN(f.created_at) AS starred_at
       FROM favorites f
       LEFT JOIN pages p
              ON f.target_kind = 'page' AND p.id = f.target_id AND p.workspace_id = ?
       LEFT JOIN collections c
              ON f.target_kind = 'collection' AND c.id = f.target_id AND c.workspace_id = ?
      WHERE p.id IS NOT NULL OR c.id IS NOT NULL
      GROUP BY f.target_id
      ORDER BY starred_at`,
    [workspaceId ?? "", workspaceId ?? ""],
  );
  const rows = data.filter((row) => !hidden.has(row.id));
  if (rows.length === 0) return null;

  function open(row: FavoriteRow): void {
    if (row.kind === "collection") {
      void navigate({ to: "/c/$collectionId", params: { collectionId: row.id } });
    } else {
      void navigate({ to: "/p/$pageId", params: { pageId: row.id } });
    }
  }

  return (
    <section aria-label="Favorites" className="mb-3">
      <div className="px-2 py-1">
        <span className="text-xs font-medium uppercase tracking-wide text-subtle">Favorites</span>
      </div>
      <div data-testid="favorites">
        {rows.map((row) => {
          const selected = row.id === openId;
          return (
            <div
              key={row.id}
              data-testid="favorite-row"
              data-selected={selected ? "true" : undefined}
              className={`group flex items-center gap-1 rounded-md pl-2 pr-1 ${
                selected ? "bg-hover text-fg" : "text-muted hover:bg-hover/60"
              }`}
            >
              <StarIcon filled className="h-3.5 w-3.5 shrink-0 text-subtle" />
              <button
                type="button"
                onClick={() => open(row)}
                aria-current={selected ? "true" : undefined}
                className="flex-1 truncate py-1.5 text-left text-sm"
              >
                {row.title || AUTO_TITLE}
              </button>
              <button
                type="button"
                onClick={() => void removeFavorite(row.id)}
                aria-label="Remove from favorites"
                title="Remove from favorites"
                className="invisible shrink-0 rounded px-1 text-subtle hover:text-fg group-hover:visible"
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
