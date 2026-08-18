/**
 * The workspaces this device should show, in one place.
 *
 * The replica can hold workspaces the server no longer agrees with — a membership revoked while
 * we were offline, a workspace deleted on another device — so the rule is: filter the replica's
 * rows against the server's list whenever we have one (`knownWorkspaceIds`, null when offline).
 * Every surface that lists workspaces must apply that filter, which is exactly why it lives here
 * rather than being re-typed at each call site. See lib/bootstrap.ts.
 */
import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { useUiStore } from "../stores/ui";

export interface WorkspaceRow {
  id: string;
  name: string;
}

export function useVisibleWorkspaces(): WorkspaceRow[] {
  const { data: rows } = useQuery<WorkspaceRow>(
    "SELECT id, name FROM workspaces ORDER BY created_at",
  );
  const knownIds = useUiStore((s) => s.knownWorkspaceIds);
  return useMemo(
    () => (knownIds ? rows.filter((row) => knownIds.includes(row.id)) : rows),
    [rows, knownIds],
  );
}
