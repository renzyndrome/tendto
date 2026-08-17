/**
 * Top-level auth + bootstrap gate.
 *
 *   no session      → sign-in / sign-up screen
 *   session, booting → run bootstrap + start the sync stream (minimal loading state)
 *   session, ready   → the routed app shell
 *
 * We intentionally do NOT block on a full first sync — that would defeat instant/offline
 * rendering. The sidebar and editor read from the local replica and fill in reactively as
 * synced data arrives.
 */
import { RouterProvider } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { AuthScreen } from "./components/auth/auth-screen";
import { AcceptInvite } from "./components/invite/accept-invite";
import { FullScreenLoader } from "./components/ui/spinner";
import { useSession } from "./lib/auth/client";
import { bootstrapWorkspaces } from "./lib/bootstrap";
import { connectDb } from "./lib/powersync/client";
import { router } from "./routes/router";
import { useUiStore } from "./stores/ui";

/** `/invite/<token>` — read here rather than from the router, see below. */
function inviteToken(): string | null {
  const match = window.location.pathname.match(/^\/invite\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function App() {
  const { data: session, isPending } = useSession();
  // Checked BEFORE the auth/bootstrap gate: an invitee typically has no session and no
  // workspace yet, so the invite screen must render outside the app shell (whose router only
  // mounts once bootstrap has produced an active workspace).
  const token = inviteToken();
  if (token) return <AcceptInvite token={token} />;

  if (isPending) return <FullScreenLoader label="Loading…" />;
  if (!session) return <AuthScreen />;
  return <AuthedApp />;
}

type BootStatus = "booting" | "ready" | "error";

function AuthedApp() {
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const setKnownWorkspaceIds = useUiStore((s) => s.setKnownWorkspaceIds);
  const [status, setStatus] = useState<BootStatus>("booting");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // Best-effort: start the sync stream. A connect failure must not block rendering —
        // PowerSync retries internally and the UI still reads local data.
        void connectDb().catch(() => undefined);

        const { activeId, knownIds } = await bootstrapWorkspaces();
        if (cancelled) return;
        // Set the authoritative list BEFORE the active id, so nothing renders a workspace
        // that only exists in this device's replica (see bootstrap.ts).
        setKnownWorkspaceIds(knownIds);
        if (activeId) setActiveWorkspace(activeId);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [setActiveWorkspace, setKnownWorkspaceIds]);

  if (status === "error") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-app">
        <div className="text-center">
          <p className="text-sm text-muted">Couldn&apos;t set up your workspace.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-md bg-accent px-3 py-1.5 text-sm text-on-accent hover:opacity-90"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  if (status === "booting") {
    return <FullScreenLoader label="Setting up your workspace…" />;
  }

  return <RouterProvider router={router} />;
}
