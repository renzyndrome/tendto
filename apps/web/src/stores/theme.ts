/**
 * Theme state (Zustand). UI-only — never synced, never in the replica.
 *
 * Three modes, not two: "system" follows the OS and is the default, so the app matches the
 * rest of the desktop until the user states a preference. "light"/"dark" pin it explicitly.
 * The choice is persisted per-device in localStorage.
 *
 * The resolved theme is applied by toggling `dark` on <html> (Tailwind's class strategy).
 * `applyStoredTheme()` runs from index.html BEFORE React mounts so there is no light flash
 * on load; keep the storage key and class name in sync with that inline script.
 */
import { create } from "zustand";

export type ThemeMode = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";

export const THEME_STORAGE_KEY = "tendto:theme";

function isMode(value: unknown): value is ThemeMode {
  return value === "light" || value === "dark" || value === "system";
}

/** The persisted choice, or "system" when unset/corrupt/unavailable (private mode). */
export function readStoredMode(): ThemeMode {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    return isMode(raw) ? raw : "system";
  } catch {
    return "system";
  }
}

function prefersDark(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === "system") return prefersDark() ? "dark" : "light";
  return mode;
}

function applyToDocument(resolved: ResolvedTheme): void {
  document.documentElement.classList.toggle("dark", resolved === "dark");
}

interface ThemeState {
  mode: ThemeMode;
  resolved: ResolvedTheme;
  setMode: (mode: ThemeMode) => void;
  /** Re-resolve after an OS change. No-op unless the mode is "system". */
  syncWithSystem: () => void;
}

const initialMode = readStoredMode();

export const useThemeStore = create<ThemeState>((set, get) => ({
  mode: initialMode,
  resolved: resolveTheme(initialMode),

  setMode: (mode) => {
    const resolved = resolveTheme(mode);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, mode);
    } catch {
      // Storage unavailable (private mode) — the theme still applies for this session.
    }
    applyToDocument(resolved);
    set({ mode, resolved });
  },

  syncWithSystem: () => {
    if (get().mode !== "system") return;
    const resolved = resolveTheme("system");
    applyToDocument(resolved);
    set({ resolved });
  },
}));

/**
 * Subscribe to OS theme changes for the lifetime of the app. Returns an unsubscribe fn.
 * Only "system" mode reacts — an explicit choice always wins.
 */
export function watchSystemTheme(): () => void {
  const query = window.matchMedia?.("(prefers-color-scheme: dark)");
  if (!query) return () => undefined;
  const onChange = () => useThemeStore.getState().syncWithSystem();
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export const THEME_LABELS: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

/** Cycle order for the sidebar toggle. */
export const THEME_CYCLE: readonly ThemeMode[] = ["system", "light", "dark"] as const;

export function nextMode(mode: ThemeMode): ThemeMode {
  const index = THEME_CYCLE.indexOf(mode);
  return THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
}
