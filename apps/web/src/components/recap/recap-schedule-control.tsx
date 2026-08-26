/**
 * When the evening recap arrives, and whether it arrives at all.
 *
 * Lives on the recap page rather than in a settings dialog: this is the one screen where
 * someone thinks "I'd like this every evening", and the app has no user-settings panel to add
 * a row to. Putting it here costs no new surface.
 *
 * Per DEVICE, deliberately — see lib/recap-schedule.ts. The row explains itself when desktop
 * notifications are off, because otherwise the setting would silently do nothing.
 */
import { useEffect, useState } from "react";

import { notificationsEnabled } from "../../lib/notifications";
import {
  formatScheduleTime,
  fromTimeValue,
  readSchedule,
  toTimeValue,
  writeSchedule,
  type RecapSchedule,
} from "../../lib/recap-schedule";

export function RecapScheduleControl() {
  const [schedule, setSchedule] = useState<RecapSchedule | null>(null);
  const [notifications, setNotifications] = useState(false);

  // Read on mount, not during render: both are browser state that can change while the tab is
  // open (another tab's setting, or the browser's own permission UI).
  useEffect(() => {
    setSchedule(readSchedule());
    setNotifications(notificationsEnabled());
  }, []);

  if (!schedule) return null;

  const update = (next: RecapSchedule) => {
    setSchedule(next);
    writeSchedule(next);
  };

  return (
    <div
      data-testid="recap-schedule"
      className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-subtle"
    >
      <label className="flex items-center gap-1.5">
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(event) => update({ ...schedule, enabled: event.target.checked })}
          data-testid="recap-schedule-enabled"
          className="accent-accent"
        />
        <span>Remind me each evening at</span>
      </label>
      <input
        type="time"
        value={toTimeValue(schedule)}
        disabled={!schedule.enabled}
        onChange={(event) => update(fromTimeValue(event.target.value, schedule))}
        aria-label="Recap time"
        data-testid="recap-schedule-time"
        className="rounded-md border border-line bg-app px-1.5 py-0.5 text-xs text-muted outline-none disabled:opacity-50"
      />
      {schedule.enabled && !notifications ? (
        // The setting is real but inert without the browser grant and the app's own switch;
        // saying so beats a toggle that quietly never fires.
        <span data-testid="recap-schedule-hint" className="text-warn">
          — turn on Notifications in the sidebar for this to arrive.
        </span>
      ) : null}
      {schedule.enabled && notifications ? (
        <span className="text-subtle">
          — while the app is open at {formatScheduleTime(schedule)}.
        </span>
      ) : null}
    </div>
  );
}
