/**
 * Invite accept screen (/invite/$token). Previews the invite, and on accept creates the caller's
 * membership server-side, sets that workspace active, and drops them into it. Auth-gated by the
 * top-level app gate — an unauthenticated visitor sees the sign-in screen first, then lands back
 * here (the token stays in the URL).
 */
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  acceptInvite,
  previewInvite,
  saveActiveWorkspaceId,
  type InvitePreview,
} from "../../lib/workspaces";
import { useUiStore } from "../../stores/ui";
import { Icon } from "../ui/icon";
import { Spinner } from "../ui/spinner";

const REASON_COPY: Record<string, string> = {
  not_found: "This invite link isn’t valid.",
  expired: "This invite link has expired. Ask for a new one.",
  accepted: "This invite has already been used.",
};

export function InviteView({ token }: { token: string }) {
  const navigate = useNavigate();
  const setActiveWorkspace = useUiStore((s) => s.setActiveWorkspace);

  const [preview, setPreview] = useState<InvitePreview | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void previewInvite(token)
      .then((p) => !cancelled && setPreview(p))
      .catch(() => !cancelled && setLoadError(true));
    return () => {
      cancelled = true;
    };
  }, [token]);

  async function join(): Promise<void> {
    if (joining) return;
    setJoining(true);
    setJoinError(null);
    try {
      const result = await acceptInvite(token);
      setActiveWorkspace(result.workspace_id);
      saveActiveWorkspaceId(result.workspace_id);
      void navigate({ to: "/" });
    } catch {
      setJoinError("Couldn’t join — the invite may have just expired.");
      setJoining(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-canvas px-4">
      <div className="w-full max-w-sm rounded-modal border border-hairline bg-surface p-8 text-center shadow-card">
        <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-[13px] bg-accent text-xl font-bold text-accent-contrast">
          T
        </div>

        {loadError ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-ink">Couldn’t load this invite</h1>
            <p className="mt-1 text-[13px] text-muted">Check your connection and try again.</p>
            <BackHome />
          </>
        ) : preview === null ? (
          <div className="mt-6 flex justify-center">
            <Spinner label="Loading invite…" />
          </div>
        ) : preview.valid ? (
          <>
            <h1 className="mt-4 text-lg font-semibold text-ink">
              Join “{preview.workspace_name}”
            </h1>
            <p className="mt-1 text-[13px] text-muted">
              You’ll join as a{" "}
              <span className="font-medium capitalize text-body">{preview.role}</span>.
            </p>
            {joinError ? <p className="mt-3 text-[12.5px] text-overdue">{joinError}</p> : null}
            <button
              type="button"
              onClick={() => void join()}
              disabled={joining}
              className="mt-5 flex w-full items-center justify-center gap-2 rounded-input bg-accent py-2.5 text-[13.5px] font-semibold text-accent-contrast hover:bg-accent-hover disabled:opacity-50"
            >
              {joining ? "Joining…" : "Join workspace"}
            </button>
            <BackHome label="Not now" />
          </>
        ) : (
          <>
            <h1 className="mt-4 text-lg font-semibold text-ink">Invite unavailable</h1>
            <p className="mt-1 text-[13px] text-muted">
              {REASON_COPY[preview.reason ?? ""] ?? "This invite can’t be used."}
            </p>
            <BackHome />
          </>
        )}
      </div>
    </div>
  );
}

function BackHome({ label = "Go to TendTo" }: { label?: string }) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => void navigate({ to: "/" })}
      className="mt-3 inline-flex items-center gap-1.5 text-[12.5px] text-muted hover:text-ink"
    >
      <Icon name="back" size={13} />
      {label}
    </button>
  );
}
