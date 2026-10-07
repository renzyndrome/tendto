/**
 * Favorites: pages and collections one user starred, listed at the top of the sidebar.
 *
 * User-private (migration 0012, the `user_private` bucket), so the replica only ever holds the
 * signed-in user's own rows and no query here filters by user. The server pins `user_id` to the
 * token subject, so the value written locally only matters until the round trip.
 *
 * Two devices starring the same target make two rows (ids are random; see the API model), so a
 * target counts once and unstarring deletes every row for it.
 */
import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { db } from "./powersync/client";

export type FavoriteKind = "page" | "collection";

export async function addFavorite(
  userId: string | null,
  kind: FavoriteKind,
  targetId: string,
): Promise<void> {
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const existing = await tx.getAll<{ id: string }>(
      "SELECT id FROM favorites WHERE target_id = ? LIMIT 1",
      [targetId],
    );
    if (existing.length > 0) return;
    await tx.execute(
      `INSERT INTO favorites (id, user_id, target_kind, target_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [crypto.randomUUID(), userId ?? "", kind, targetId, now, now],
    );
  });
}

export async function removeFavorite(targetId: string): Promise<void> {
  await db.execute("DELETE FROM favorites WHERE target_id = ?", [targetId]);
}

/** Drop the favorites of deleted rows, so they do not linger in the table. */
export async function removeFavoritesFor(targetIds: readonly string[]): Promise<void> {
  if (targetIds.length === 0) return;
  await db.execute(
    `DELETE FROM favorites WHERE target_id IN (${targetIds.map(() => "?").join(", ")})`,
    [...targetIds],
  );
}

/** The ids of every starred page and collection. */
export function useFavoriteIds(): ReadonlySet<string> {
  const { data } = useQuery<{ target_id: string }>("SELECT DISTINCT target_id FROM favorites");
  return useMemo(() => new Set(data.map((row) => row.target_id)), [data]);
}
