/**
 * Applies Appearance preferences to the document by stamping data-* attributes on <html>.
 * All the visual work is done by the CSS-variable ramps in index.css keyed off these attributes.
 * Kept side-effect-only and framework-free so it can run pre-paint (main.tsx) and on every change.
 */
import { DEFAULT_PREFERENCES, type Mode, type Preferences } from "./types";

const STORAGE_KEY = "tendto:prefs";

const darkQuery = (): MediaQueryList | null =>
  typeof window !== "undefined" && window.matchMedia
    ? window.matchMedia("(prefers-color-scheme: dark)")
    : null;

function resolveMode(mode: Mode): "light" | "dark" {
  if (mode !== "system") return mode;
  return darkQuery()?.matches ? "dark" : "light";
}

export function applyTheme(prefs: Preferences): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.mode = resolveMode(prefs.mode);
  root.dataset.accent = prefs.accent;
  root.dataset.docFont = prefs.docFont;
  root.dataset.density = prefs.density;
  root.dataset.editorWidth = prefs.editorWidth;
}

/** Read persisted prefs synchronously (used to apply the theme before first paint). */
function readPersisted(): Preferences {
  if (typeof localStorage === "undefined") return DEFAULT_PREFERENCES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_PREFERENCES;
    // zustand/persist stores { state, version }; tolerate either shape.
    const parsed = JSON.parse(raw) as { state?: { prefs?: Partial<Preferences> } };
    return { ...DEFAULT_PREFERENCES, ...(parsed.state?.prefs ?? {}) };
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

/**
 * Apply the persisted theme immediately (call before render to avoid a flash) and keep the
 * resolved mode in sync with the OS when the preference is "system". Returns an unsubscribe.
 */
export function bootstrapTheme(): () => void {
  const prefs = readPersisted();
  applyTheme(prefs);

  const mql = darkQuery();
  if (!mql) return () => undefined;
  const onChange = (): void => {
    // Re-read persisted mode; only "system" tracks the OS.
    applyTheme(readPersisted());
  };
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

export const PREFS_STORAGE_KEY = STORAGE_KEY;
