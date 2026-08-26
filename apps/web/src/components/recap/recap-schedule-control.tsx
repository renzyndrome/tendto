/**
 * When the evening recap arrives, whether it arrives at all, and whether it *can*.
 *
 * Lives on the recap page rather than in a settings dialog: this is the one screen where
 * someone thinks "I'd like this every evening", and the app has no user-settings panel to add
 * a row to. Putting it here costs no new surface.
 *
 * The row is deliberately honest about the whole chain, because three separate things have to
 * be true before anything arrives — the schedule is on, the browser has granted notifications,
 * and TendTo's own switch is on — and a setting that silently does nothing is worse than no
 * setting. Whichever link is missing is the one it offers to fix.
 *
 * Settings are per DEVICE, matching the notifications toggle, which is deliberately per-device
 * too: the thing being configured is what THIS machine does at nine o'clock.
 */
import { useCallback, useEffect, useState } from "react";

import { engineLabel, loadEngineStatus } from "../../lib/ai/compose";
import {
  notificationsEnabled,
  requestNotificationPermission,
  setNotificationsEnabled,
} from "../../lib/notifications";
import {
  formatScheduleTime,
  fromTimeValue,
  readSchedule,
  sendRecapNow,
  toTimeValue,
  writeSchedule,
  type RecapSchedule,
} from "../../lib/recap-schedule";

type SendState = "idle" | "sending" | "sent" | "failed";

export function RecapScheduleControl({ onOpenRecap }: { onOpenRecap: () => void }) {
  const [schedule, setSchedule] = useState<RecapSchedule | null>(null);
  const [notifications, setNotifications] = useState(false);
  const [engine, setEngine] = useState<string | null>(null);
  const [send, setSend] = useState<SendState>("idle");

  // Read on mount, not during render: both are browser state that can change while the tab is
  // open (another tab's setting, or the browser's own permission UI).
  useEffect(() => {
    setSchedule(readSchedule());
    setNotifications(notificationsEnabled());
    void loadEngineStatus().then((status) => setEngine(status.engine));
  }, []);

  /** Grant + switch on in one click. "Go and find it in the sidebar" is not a fix. */
  const enableNotifications = useCallback(async () => {
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      setNotifications(false);
      return;
    }
    setNotificationsEnabled(true);
    setNotifications(true);
  }, []);

  const trySend = useCallback(async () => {
    setSend("sending");
    try {
      await sendRecapNow(onOpenRecap);
      setSend("sent");
    } catch {
      setSend("failed");
    }
  }, [onOpenRecap]);

  if (!schedule) return null;

  const update = (next: RecapSchedule) => {
    setSchedule(next);
    writeSchedule(next);
  };

  const armed = schedule.enabled && notifications;

  return (
    <div data-testid="recap-schedule" className="mt-3 text-xs text-subtle">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
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
          <button
            type="button"
            onClick={() => void enableNotifications()}
            data-testid="recap-schedule-hint"
            className="rounded-md border border-warn/40 px-1.5 py-0.5 text-warn hover:bg-hover"
          >
            Turn on notifications
          </button>
        ) : null}

        {armed ? (
          <button
            type="button"
            onClick={() => void trySend()}
            disabled={send === "sending"}
            data-testid="recap-send-now"
            className="rounded-md border border-line px-1.5 py-0.5 text-muted hover:text-fg disabled:opacity-50"
          >
            {send === "sending" ? "Sending…" : "Send one now"}
          </button>
        ) : null}
      </div>

      <p data-testid="recap-schedule-status" className="mt-1">
        {armed ? `Arrives at ${formatScheduleTime(schedule)} while the app is open. ` : ""}
        {engine === null ? null : engine === "offline" ? (
          // The recap still works without a model — the digest is a plain database read. Only
          // the written narrative is missing, so say that rather than implying it is broken.
          <span data-testid="recap-engine">
            No AI engine configured, so you&apos;ll get your activity without the written recap —
            set <code className="text-muted">AI_CLI</code> or{" "}
            <code className="text-muted">AI_API_KEY</code> for that.
          </span>
        ) : (
          <span data-testid="recap-engine">Written by {engineLabel(engine)}.</span>
        )}
        {send === "sent" ? <span className="ml-1 text-muted">Sent.</span> : null}
        {send === "failed" ? (
          <span className="ml-1 text-danger">Couldn&apos;t send — check the AI settings.</span>
        ) : null}
      </p>
    </div>
  );
}
