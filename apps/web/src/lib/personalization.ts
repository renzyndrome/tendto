/**
 * How the editor looks to you: font and size. Per-device, never synced.
 *
 * A preference, not content — it belongs to the machine you are reading on, the way the theme
 * does. Stored under one `tendto:*` key and validated on the way in, because a hand-edited or
 * half-written value must not be able to make the app unreadable.
 *
 * Every face is one the operating system already has. Nothing is downloaded, so the setting
 * works offline and costs no bytes — which matters for an app whose whole promise is that it
 * opens instantly.
 *
 * `applyToDocument` writes two CSS variables that `index.css` binds the editor to. The same
 * two are written before first paint by the inline script in index.html; keep the storage key
 * in step with that copy, exactly as the theme does.
 */

export type FontChoice = "sans" | "serif" | "mono" | "inter";

export interface Personalization {
  font: FontChoice;
  /** Base size of the page body, in pixels. Headings scale off it. */
  size: number;
}

export const PERSONALIZATION_STORAGE_KEY = "tendto:personalization";

/** What the editor has always looked like: BlockNote's bundled Inter at 16px. */
export const DEFAULT_PERSONALIZATION: Personalization = { font: "inter", size: 16 };

export const FONT_SIZES: readonly number[] = [14, 15, 16, 17, 18, 20] as const;

const SYSTEM_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

export const FONT_STACKS: Record<FontChoice, string> = {
  inter: `Inter, ${SYSTEM_SANS}`,
  sans: SYSTEM_SANS,
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
};

export const FONT_LABELS: Record<FontChoice, string> = {
  inter: "Inter",
  sans: "System",
  serif: "Serif",
  mono: "Mono",
};

export const FONT_CHOICES: readonly FontChoice[] = ["inter", "sans", "serif", "mono"] as const;

function isFont(value: unknown): value is FontChoice {
  return typeof value === "string" && value in FONT_STACKS;
}

/** The stored preference, or the default when unset, corrupt, or storage is unavailable. */
export function readPersonalization(): Personalization {
  try {
    const raw = localStorage.getItem(PERSONALIZATION_STORAGE_KEY);
    if (!raw) return DEFAULT_PERSONALIZATION;
    const parsed = JSON.parse(raw) as Partial<Personalization>;
    return {
      font: isFont(parsed.font) ? parsed.font : DEFAULT_PERSONALIZATION.font,
      size:
        typeof parsed.size === "number" && FONT_SIZES.includes(parsed.size)
          ? parsed.size
          : DEFAULT_PERSONALIZATION.size,
    };
  } catch {
    return DEFAULT_PERSONALIZATION;
  }
}

export function writePersonalization(value: Personalization): void {
  try {
    localStorage.setItem(PERSONALIZATION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // Storage unavailable — the choice still applies for this session.
  }
}

/** Paint a choice, without saving it. This is what makes the preview a preview. */
export function applyPersonalization(value: Personalization): void {
  const root = document.documentElement;
  root.style.setProperty("--tendto-font", FONT_STACKS[value.font]);
  root.style.setProperty("--tendto-font-size", `${value.size}px`);
}
