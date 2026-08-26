/**
 * Who else is reading this, as a couple of initials.
 *
 * Renders NOTHING when you are alone — which is nearly always — so the common case stays exactly
 * as calm as it was before presence existed. That is the whole reason this passes the clutter
 * test: it is not a status panel that happens to be empty, it is absent until it has something
 * to say. Deliberately no "last seen", no idle/away, and no workspace-wide online list; those
 * report on people rather than on the page, which is the collaboration noise
 * docs/planning/03-roadmap.md rules out.
 */
import type { Viewer } from "../../lib/presence/client";

/** Up to two letters from a display name, or from an email's local part. */
function initials(label: string): string {
  const name = label.includes("@") ? label.slice(0, label.indexOf("@")) : label;
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const letters = parts.length === 1 ? parts[0].slice(0, 2) : parts[0][0] + parts[1][0];
  return letters.toUpperCase();
}

/** How many faces before it becomes a count. Three is enough to read at a glance. */
const MAX_SHOWN = 3;

export function PresenceBar({ others }: { others: Viewer[] }) {
  if (others.length === 0) return null;

  const shown = others.slice(0, MAX_SHOWN);
  const overflow = others.length - shown.length;
  const summary =
    others.length === 1
      ? `${others[0].label} is also here`
      : `${others.map((viewer) => viewer.label).join(", ")} are also here`;

  return (
    <div
      className="flex shrink-0 items-center"
      data-testid="presence-bar"
      title={summary}
      aria-label={summary}
    >
      {shown.map((viewer, index) => (
        <span
          key={viewer.user_id}
          data-testid="presence-viewer"
          // Overlapped like a stack of faces; the ring keeps them legible where they meet.
          className={`flex h-6 w-6 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-on-accent ring-2 ring-elevated ${
            index === 0 ? "" : "-ml-2"
          }`}
        >
          {initials(viewer.label)}
        </span>
      ))}
      {overflow > 0 ? (
        <span className="-ml-2 flex h-6 w-6 items-center justify-center rounded-full bg-hover text-[10px] font-medium text-muted ring-2 ring-elevated">
          +{overflow}
        </span>
      ) : null}
    </div>
  );
}
