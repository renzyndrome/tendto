/**
 * Theme toggle — one sidebar row that cycles System → Light → Dark.
 *
 * A cycling button rather than a settings panel: three states is few enough that a menu would
 * be more clutter than it saves, and the current mode is always readable in the label.
 */
import { nextMode, THEME_LABELS, useThemeStore } from "../../stores/theme";

const ICONS: Record<string, string> = {
  system: "◐",
  light: "☀",
  dark: "☾",
};

export function ThemeToggle() {
  const mode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);
  const upcoming = nextMode(mode);

  return (
    <button
      type="button"
      onClick={() => setMode(upcoming)}
      title={`Theme: ${THEME_LABELS[mode]} — switch to ${THEME_LABELS[upcoming]}`}
      aria-label={`Theme: ${THEME_LABELS[mode]}. Switch to ${THEME_LABELS[upcoming]}.`}
      data-testid="theme-toggle"
      className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm text-muted hover:bg-hover hover:text-fg"
    >
      <span>Theme</span>
      <span className="flex items-center gap-1.5 text-xs text-subtle">
        <span aria-hidden>{ICONS[mode]}</span>
        {THEME_LABELS[mode]}
      </span>
    </button>
  );
}
