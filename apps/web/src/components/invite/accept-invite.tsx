/**
 * Invitation landing page (/invite/$token).
 *
 * Rendered OUTSIDE the app shell, because the recipient is usually not a member of anything
 * yet — and may not even be signed in. The preview is public (workspace name + offered role +
 * the invited address only); accepting requires being signed in as exactly that address,
 * which the server re-checks (a leaked link must not grant access to whoever holds it).
 */
import { useEffect, useState } from "react";

import { useSession } from "../../lib/auth/client";
import {
  acceptInvitation,
  previewInvitation,
  ROLE_LABELS,
  type InvitationPreview,
} from "../../lib/members";
import { storeActiveWorkspaceId } from "../../lib/workspaces";
import { AuthScreen } from "../auth/auth-screen";
import { FullScreenLoader } from "../ui/spinner";

export function AcceptInvite({ token }: { token: string }) {
  const { data: session, isPending } = useSession();
  const [preview, setPreview] = useState<InvitationPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void previewInvitation(token)
      .then((result) => {
        if (!cancelled) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "This invitation link isn't valid.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function accept(): Promise<void> {
    setAccepting(true);
    setError(null);
    try {
      const workspaceId = await acceptInvitation(token);
      // Land in the workspace that was just joined, not whatever was last open.
      storeActiveWorkspaceId(workspaceId);
      window.location.replace("/");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't accept the invitation");
      setAccepting(false);
    }
  }

  if (isPending) return <FullScreenLoader label="Loading…" />;

  // Not signed in: show the normal auth screen. better-auth re-renders this component on
  // success and the invite is still in the URL, so they land right back here.
  if (!session) {
    return (
      <div>
        <p className="bg-surface px-4 pt-6 text-center text-sm text-muted">
          {preview
            ? `Sign in as ${preview.email} to join “${preview.workspace_name}”.`
            : "Sign in to accept your invitation."}
        </p>
        <AuthScreen />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-2xl font-semibold tracking-tight text-fg">TendTo</h1>

        {error ? (
          <>
            <p role="alert" className="mt-4 text-sm text-danger">
              {error}
            </p>
            <a href="/" className="mt-4 inline-block text-sm text-muted hover:text-fg">
              Go to your workspace
            </a>
          </>
        ) : !preview ? (
          <p className="mt-4 text-sm text-muted">Checking your invitation…</p>
        ) : preview.expired ? (
          <>
            <p className="mt-4 text-sm text-muted">
              This invitation to “{preview.workspace_name}” has expired. Ask for a new one.
            </p>
            <a href="/" className="mt-4 inline-block text-sm text-muted hover:text-fg">
              Go to your workspace
            </a>
          </>
        ) : (
          <>
            <p className="mt-4 text-sm text-muted">
              You've been invited to join{" "}
              <span className="font-medium text-fg">{preview.workspace_name}</span> as{" "}
              {ROLE_LABELS[preview.role]}.
            </p>
            <button
              type="button"
              onClick={() => void accept()}
              disabled={accepting}
              data-testid="accept-invite"
              className="mt-5 w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-on-accent transition hover:opacity-90 disabled:opacity-50"
            >
              {accepting ? "Joining…" : "Accept invitation"}
            </button>
            <a href="/" className="mt-3 inline-block text-sm text-muted hover:text-fg">
              Not now
            </a>
          </>
        )}
      </div>
    </div>
  );
}
