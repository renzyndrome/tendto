/**
 * Notifications toggle — one sidebar row, mirroring the theme toggle.
 *
 * Opt-in only: nothing ever prompts for permission on its own, because a permission dialog you
 * didn't ask for is exactly the kind of noise this product avoids. Clicking asks the browser
 * the first time, then toggles TendTo's own switch independently of the site grant — so you can
 * silence reminders without digging through browser settings.
 */
import { useCallback, useEffect, useState } from "react";

import {
  notificationsEnabled,
  permissionState,
  requestNotificationPermission,
  setNotificationsEnabled,
  type NotificationPermissionState,
} from "../../lib/notifications";

type Status = "unsupported" | "blocked" | "on" | "off";

function readStatus(): Status {
  const permission: NotificationPermissionState = permissionState();
  if (permission === "unsupported") return "unsupported";
  if (permission === "denied") return "blocked";
  if (permission === "granted") return notificationsEnabled() ? "on" : "off";
  return "off";
}

const LABELS: Record<Status, string> = {
  unsupported: "Unavailable",
  blocked: "Blocked",
  on: "On",
  off: "Off",
};

const HINTS: Record<Status, string> = {
  unsupported: "This browser doesn't support notifications",
  blocked: "Notifications are blocked for this site in your browser settings",
  on: "Reminders for items due today, and Pomodoro phase changes",
  off: "Turn on reminders for due items and the Pomodoro timer",
};

export function NotificationToggle() {
  const [status, setStatus] = useState<Status>("off");

  // Read on mount, not during render: Notification.permission is a browser API, and the value
  // can change from browser UI while the tab is open.
  useEffect(() => setStatus(readStatus()), []);

  const toggle = useCallback(async () => {
    if (status === "unsupported" || status === "blocked") return;
    if (status === "on") {
      setNotificationsEnabled(false);
      setStatus("off");
      return;
    }
    const permission = await requestNotificationPermission();
    if (permission !== "granted") {
      setStatus(permission === "denied" ? "blocked" : "off");
      return;
    }
    setNotificationsEnabled(true);
    setStatus("on");
  }, [status]);

  const disabled = status === "unsupported" || status === "blocked";

  return (
    <button
      type="button"
      onClick={() => void toggle()}
      disabled={disabled}
      title={HINTS[status]}
      aria-label={`Notifications: ${LABELS[status]}`}
      data-testid="notification-toggle"
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
    >
      <span>Notifications</span>
      <span className="flex items-center gap-1.5 text-xs text-subtle">
        <span aria-hidden>{status === "on" ? "🔔" : "🔕"}</span>
        {LABELS[status]}
      </span>
    </button>
  );
}
