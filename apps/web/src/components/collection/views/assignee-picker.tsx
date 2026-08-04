/**
 * Assignee picker — a select over the workspace's members instead of free text, so a solo user
 * can assign work to themselves in one click and a team picks real people rather than typing
 * names that never match.
 *
 * Two deliberate fallbacks: a value that isn't in the member list (a legacy free-text assignee,
 * or someone since removed) is still offered as an option so selecting elsewhere is a choice and
 * not a silent data loss; and if the member list can't load (offline — it's an API call), the
 * current value is all we show.
 */
import { useEffect, useState } from "react";

import { loadAssigneeOptions, type AssigneeOption } from "../../../lib/items/assignees";

interface AssigneePickerProps {
  workspaceId: string | null;
  value: string;
  onChange: (value: string) => void;
  className?: string;
  ariaLabel?: string;
}

export function AssigneePicker({
  workspaceId,
  value,
  onChange,
  className,
  ariaLabel = "Assignee",
}: AssigneePickerProps) {
  const [options, setOptions] = useState<AssigneeOption[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let cancelled = false;
    void loadAssigneeOptions(workspaceId).then((loaded) => {
      if (!cancelled) setOptions(loaded);
    });
    return () => {
      cancelled = true;
    };
  }, [workspaceId]);

  const known = options.some((option) => option.value === value);

  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={ariaLabel}
      className={className}
    >
      <option value="">Unassigned</option>
      {/* Keep an unrecognised assignee visible until the user actively re-picks. */}
      {value && !known ? <option value={value}>{value}</option> : null}
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}
