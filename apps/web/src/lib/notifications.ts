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
 *
 * Two backends, one API. The browser uses `window.Notification`. The desktop shell uses Tauri's
 * notification plugin instead, because the webview's own Notification permission is not wired to
 * anything the OS will honour — the shell has to ask through Rust. The plugin's API is async and
 * this module's is deliberately not (callers fire notifications from timers), so the desktop
 * permission is cached and primed once at boot by `primeDesktopNotifications()`.
 *
 * One accepted loss on desktop: the plugin takes no `tag` and gives no click callback, so a
 * desktop reminder neither replaces its predecessor nor navigates when clicked. The dedupe that
 * actually matters (never notifying twice for the same item) lives in due-watcher.ts, not in the
 * tag.
 */
import { isDesktop } from "./platform";

export type NotificationPermissionState = "unsupported" | "default" | "granted" | "denied";

/** Per-device opt-in, kept separate from the browser grant: revoking it silences TendTo
 *  without having to fiddle with site permissions. */
const ENABLED_KEY = "tendto:notifications";

/**
 * The desktop shell's permission, mirrored from Rust. Cached because the callers of
 * `permissionState()` are synchronous; `primeDesktopNotifications()` fills it at boot and
 * `requestNotificationPermission()` keeps it current.
 */
let desktopPermission: NotificationPermissionState = "default";

/** Read the OS notification permission once at startup. Desktop only; no-op in the browser. */
export async function primeDesktopNotifications(): Promise<void> {
  if (!isDesktop) return;
  try {
    const { isPermissionGranted } = await import("@tauri-apps/plugin-notification");
    desktopPermission = (await isPermissionGranted()) ? "granted" : "default";
  } catch {
    // Plugin missing or blocked — leave it at "default" so the toggle can still ask.
  }
}

export function notificationsSupported(): boolean {
  if (isDesktop) return true;
  return typeof window !== "undefined" && "Notification" in window;
}

export function permissionState(): NotificationPermissionState {
  if (isDesktop) return desktopPermission;
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

/** Ask the browser (or, on desktop, the OS via Rust) for permission. Returns the new state. */
export async function requestNotificationPermission(): Promise<NotificationPermissionState> {
  if (isDesktop) {
    try {
      const { isPermissionGranted, requestPermission } = await import(
        "@tauri-apps/plugin-notification"
      );
      desktopPermission = (await isPermissionGranted())
        ? "granted"
        : ((await requestPermission()) as NotificationPermissionState);
    } catch {
      desktopPermission = "denied";
    }
    return desktopPermission;
  }
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
  if (isDesktop) {
    // Fire and forget: the caller is a timer tick, and a failed reminder must never surface as
    // an unhandled rejection. `tag` and `onClick` have no equivalent here — see the file header.
    void import("@tauri-apps/plugin-notification")
      .then(({ sendNotification }) => sendNotification({ title, body: options.body }))
      .catch(() => undefined);
    return;
  }
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
