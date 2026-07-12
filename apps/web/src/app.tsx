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
import { FullScreenLoader } from "./components/ui/spinner";
import { useSession } from "./lib/auth/client";
import { bootstrapWorkspaces } from "./lib/bootstrap";
import { connectDb } from "./lib/powersync/client";
import { router } from "./routes/router";
import { useUiStore } from "./stores/ui";

export function App() {
  const { data: session, isPending } = useSession();

  if (isPending) return <FullScreenLoader label="Loading…" />;
  if (!session) return <AuthScreen />;
  return <AuthedApp />;
}

type BootStatus = "booting" | "ready" | "error";

function AuthedApp() {
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);
  const [status, setStatus] = useState<BootStatus>("booting");

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      try {
        // Best-effort: start the sync stream. A connect failure must not block rendering —
        // PowerSync retries internally and the UI still reads local data.
        void connectDb().catch(() => undefined);

        const workspaceId = await bootstrapWorkspaces();
        if (cancelled) return;
        if (workspaceId) setActiveWorkspace(workspaceId);
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("error");
      }
    }

    void boot();
    return () => {
      cancelled = true;
    };
  }, [setActiveWorkspace]);

  if (status === "error") {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-white">
        <div className="text-center">
          <p className="text-sm text-neutral-600">Couldn&apos;t set up your workspace.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="mt-3 rounded-md bg-neutral-900 px-3 py-1.5 text-sm text-white hover:bg-neutral-800"
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
