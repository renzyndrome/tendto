/**
 * Desktop notifications — device-local, never synced, never server-driven.
 *
 * Two independent sources, deliberately kept separate so one can't drown the other:
 *   - due reminders for items due today (see due-watcher.ts)
 *   - Pomodoro phase changes in Focus
 * Each uses its own `tag`, so the OS replaces a superseded notification of the same kind
 * instead of stacking them.
 *
 * This stays on the calm side of docs/planning 03 ("no notification systems"): that rules out
 * activity feeds about what OTHER people did, not a reminder about your own deadline. There is
 * no digest, no badge count, and nothing fires unless the user turns it on.
 */

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

/** Per-device opt-in, kept separate from the browser grant: revoking it silences TendTo
 *  without having to fiddle with site permissions. */
const ENABLED_KEY = "tendto:notifications";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): NotificationPermissionState {
  if (!notificationsSupported()) return "unsupported";
  return Notification.permission as NotificationPermissionState;
}

/**
 * Both conditions must hold: the browser granted permission AND the user switched TendTo's
 * reminders on. Requiring the explicit "on" (rather than treating "not off" as enabled) means
 * a site permission granted for some other reason never starts firing reminders by itself.
 */
export function notificationsEnabled(): boolean {
  if (permissionState() !== "granted") return false;
  try {
    return localStorage.getItem(ENABLED_KEY) === "on";
  } catch {
    return false;
  }
}

export function setNotificationsEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? "on" : "off");
  } catch {
    // Storage unavailable — the setting just won't survive a reload.
  }
}

/** Ask the browser for permission. Returns the resulting state. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission === "granted") return "granted";
  try {
    return (await Notification.requestPermission()) as NotificationPermissionState;
  } catch {
    return permissionState();
  }
}

interface NotifyOptions {
  body?: string;
  /** Same tag ⇒ the OS replaces the previous notification instead of stacking. */
  tag?: string;
  onClick?: () => void;
}

/** Fire a notification if the user has both granted and enabled them. No-op otherwise. */
export function notify(title: string, options: NotifyOptions = {}): void {
  if (!notificationsEnabled()) return;
  try {
    const notification = new Notification(title, { body: options.body, tag: options.tag });
    if (options.onClick) {
      notification.onclick = () => {
        window.focus();
        options.onClick?.();
        notification.close();
      };
    }
  } catch {
    // Some browsers throw for Notification construction outside a service worker; a failed
    // reminder must never break the app.
  }
}
