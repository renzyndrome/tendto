/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  // Class strategy (not "media"): the theme store owns the `dark` class on <html>, so an
  // explicit light/dark choice can override the OS preference. See src/stores/theme.ts.
  darkMode: "class",
  theme: {
    extend: {
      // Semantic tokens backed by CSS variables (defined in index.css). Components name the
      // ROLE, never the shade — so each component is written once and both themes follow.
      // `<alpha-value>` keeps Tailwind opacity modifiers (e.g. bg-hover/60) working.
      colors: {
        app: "rgb(var(--c-app) / <alpha-value>)",
        surface: "rgb(var(--c-surface) / <alpha-value>)",
        elevated: "rgb(var(--c-elevated) / <alpha-value>)",
        line: "rgb(var(--c-line) / <alpha-value>)",
        hover: "rgb(var(--c-hover) / <alpha-value>)",
        fg: "rgb(var(--c-fg) / <alpha-value>)",
        muted: "rgb(var(--c-muted) / <alpha-value>)",
        subtle: "rgb(var(--c-subtle) / <alpha-value>)",
        danger: "rgb(var(--c-danger) / <alpha-value>)",
        warn: "rgb(var(--c-warn) / <alpha-value>)",
        accent: "rgb(var(--c-accent) / <alpha-value>)",
        "on-accent": "rgb(var(--c-on-accent) / <alpha-value>)",
      },
    },
  },
  plugins: [],
};
