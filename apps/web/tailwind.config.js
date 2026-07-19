/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Mode is driven by a `data-mode` attribute on <html> (resolved from the pref + system).
  // Enabling the selector strategy lets one-off `dark:` utilities work too.
  darkMode: ["selector", '[data-mode="dark"]'],
  theme: {
    extend: {
      colors: {
        // Meadow palette — every value is a CSS variable so the Appearance settings can
        // flip mode/accent live without a reload. See index.css for the definitions.
        canvas: "var(--canvas)",
        panel: "var(--panel)",
        surface: "var(--surface)",
        ink: "var(--ink)",
        body: "var(--body)",
        secondary: "var(--secondary)",
        muted: "var(--muted)",
        faint: "var(--faint)",
        hairline: "var(--hairline)",
        "hairline-strong": "var(--hairline-strong)",
        "border-soft": "var(--border)",
        "border-hover": "var(--border-hover)",
        chip: "var(--chip)",
        chevron: "var(--chevron)",
        sync: "var(--sync)",
        overdue: "var(--overdue)",
        tooltip: "var(--tooltip-bg)",
        "tooltip-text": "var(--tooltip-text)",
        "row-hover": "var(--row-hover)",
        "btn-hover": "var(--btn-hover)",
        accent: {
          DEFAULT: "var(--accent)",
          hover: "var(--accent-hover)",
          soft: "var(--accent-soft)",
          "soft-strong": "var(--accent-soft-strong)",
          "soft-text": "var(--accent-soft-text)",
          contrast: "var(--accent-contrast)",
          glyph: "var(--accent-glyph)",
        },
      },
      fontFamily: {
        sans: ['"Albert Sans"', "system-ui", "sans-serif"],
        serif: ['"Source Serif 4"', "Georgia", "serif"],
        mono: ["ui-monospace", "Menlo", "monospace"],
        // The document typeface follows the Appearance → Document type preference.
        doc: ["var(--doc-font)"],
      },
      fontSize: {
        "section-label": [
          "10.5px",
          { lineHeight: "1.2", letterSpacing: "0.08em", fontWeight: "600" },
        ],
        meta: ["11.5px", { lineHeight: "1.4" }],
        "doc-title": [
          "38px",
          { lineHeight: "1.15", letterSpacing: "-0.02em", fontWeight: "700" },
        ],
        "doc-h2": ["22px", { lineHeight: "1.3", letterSpacing: "-0.01em", fontWeight: "600" }],
        "doc-body": ["15.5px", { lineHeight: "1.65" }],
      },
      borderRadius: {
        row: "7px",
        input: "8px",
        card: "10px",
        modal: "16px",
        pill: "100px",
      },
      boxShadow: {
        card: "0 1px 2px rgba(31,29,24,.04)",
        segment: "0 1px 2px rgba(31,29,24,.08)",
        menu: "0 10px 30px rgba(31,29,24,.12)",
        modal: "0 24px 60px rgba(31,29,24,.3)",
        drag: "0 14px 32px rgba(31,29,24,.2)",
        tooltip: "0 16px 40px rgba(31,29,24,.3)",
        pill: "0 6px 20px rgba(31,29,24,.1)",
      },
      maxWidth: {
        doc: "var(--doc-max-width)",
      },
      spacing: {
        sidebar: "244px",
      },
      keyframes: {
        "pop-in": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "sync-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.35" },
        },
      },
      animation: {
        "pop-in": "pop-in 120ms ease-out",
        "sync-pulse": "sync-pulse 1.2s ease-in-out infinite",
      },
    },
  },
  plugins: [],
};
