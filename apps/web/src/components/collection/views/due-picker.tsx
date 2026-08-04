/**
 * Due picker — a date plus an OPTIONAL time.
 *
 * The time input only appears once a date exists, because a time with no day is meaningless;
 * clearing the date clears both. See lib/items/due.ts for the stored format.
 */
import { formatDue, parseDue } from "../../../lib/items/due";

interface DuePickerProps {
  value: string;
  onChange: (value: string) => void;
  /** Rendered inline (table cell) vs stacked (card details). */
  compact?: boolean;
  idPrefix?: string;
}

const FIELD =
  "rounded border border-line bg-app px-1.5 py-1 text-xs text-muted outline-none focus:border-fg";

export function DuePicker({ value, onChange, compact = false, idPrefix = "due" }: DuePickerProps) {
  const { date, time } = parseDue(value);

  return (
    <span className={compact ? "flex items-center gap-1" : "flex flex-1 items-center gap-1"}>
      <input
        type="date"
        value={date}
        onChange={(event) => onChange(formatDue(event.target.value, time))}
        aria-label="Due date"
        data-testid={`${idPrefix}-date`}
        className={`${FIELD} ${compact ? "" : "flex-1"}`}
      />
      {date ? (
        <input
          type="time"
          value={time}
          onChange={(event) => onChange(formatDue(date, event.target.value))}
          aria-label="Due time (optional)"
          title="Optional time"
          data-testid={`${idPrefix}-time`}
          className={FIELD}
        />
      ) : null}
    </span>
  );
}
