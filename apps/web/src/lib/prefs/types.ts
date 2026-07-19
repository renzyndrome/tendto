/** Appearance preferences — per device (persisted to localStorage), applied live to :root. */

export type Mode = "light" | "dark" | "system";
export type Accent = "green" | "blue" | "terracotta" | "plum" | "mono";
export type DocFont = "sans" | "serif" | "mono";
export type Density = "comfortable" | "compact";
export type EditorWidth = "narrow" | "full";

export interface Preferences {
  mode: Mode;
  accent: Accent;
  docFont: DocFont;
  density: Density;
  editorWidth: EditorWidth;
}

export const DEFAULT_PREFERENCES: Preferences = {
  mode: "system",
  accent: "green",
  docFont: "sans",
  density: "comfortable",
  editorWidth: "narrow",
};

/** Swatch colors shown in Appearance → Accent (mirror the CSS ramps in index.css). */
export const ACCENT_SWATCHES: { id: Accent; label: string; color: string }[] = [
  { id: "green", label: "Meadow green", color: "oklch(0.55 0.11 152)" },
  { id: "blue", label: "Blue", color: "oklch(0.55 0.11 250)" },
  { id: "terracotta", label: "Terracotta", color: "oklch(0.55 0.11 45)" },
  { id: "plum", label: "Plum", color: "oklch(0.55 0.11 320)" },
  { id: "mono", label: "Mono", color: "#3b372f" },
];
