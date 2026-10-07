/**
 * Personalization — theme, font and size, previewed on the real page behind it.
 *
 * Anchored to the right edge over a nearly clear backdrop, rather than centred over a dimmed
 * one, for one reason: the thing being changed is the page you are already reading. A centred
 * dialog would cover it and leave you judging a sample paragraph instead of your own writing.
 *
 * Every change paints immediately and none of it is saved until Save. Cancel, Escape and a
 * click outside all put back exactly what was there — the same bargain the AI panel makes, for
 * the same reason: a setting you were only trying out should not follow you to the next
 * session.
 */
import { useEffect, useRef, useState } from "react";

import {
  applyPersonalization,
  FONT_CHOICES,
  FONT_LABELS,
  FONT_SIZES,
  FONT_STACKS,
  readPersonalization,
  writePersonalization,
  type Personalization as Prefs,
} from "../../lib/personalization";
import {
  previewTheme,
  THEME_CYCLE,
  THEME_LABELS,
  useThemeStore,
  type ThemeMode,
} from "../../stores/theme";

interface PersonalizationProps {
  onClose: () => void;
}

export function Personalization({ onClose }: PersonalizationProps) {
  const savedMode = useThemeStore((s) => s.mode);
  const setMode = useThemeStore((s) => s.setMode);

  // What was in force when the dialog opened. Cancel puts exactly this back.
  const original = useRef<{ mode: ThemeMode; prefs: Prefs }>({
    mode: savedMode,
    prefs: readPersonalization(),
  });
  const [mode, setDraftMode] = useState<ThemeMode>(original.current.mode);
  const [prefs, setPrefs] = useState<Prefs>(original.current.prefs);
  const committed = useRef(false);

  // Paint each change straight onto the page behind the dialog.
  useEffect(() => {
    applyPersonalization(prefs);
  }, [prefs]);
  useEffect(() => {
    previewTheme(mode);
  }, [mode]);

  // Whatever closes the dialog, an uncommitted preview is undone. Covers Escape, Cancel, the
  // backdrop and an unmount — there is no path that leaves a half-chosen look behind.
  useEffect(() => {
    return () => {
      if (committed.current) return;
      applyPersonalization(original.current.prefs);
      previewTheme(original.current.mode);
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  function save(): void {
    writePersonalization(prefs);
    setMode(mode);
    committed.current = true;
    onClose();
  }

  const dirty =
    mode !== original.current.mode ||
    prefs.font !== original.current.prefs.font ||
    prefs.size !== original.current.prefs.size;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Personalization"
      data-testid="personalization"
      onClick={onClose}
      // Barely-there backdrop: the page behind it is the point.
      className="fixed inset-0 z-50 flex justify-end bg-black/10 p-4"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full w-full max-w-xs flex-col overflow-y-auto rounded-xl border border-line bg-elevated shadow-xl"
      >
        <header className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Personalization</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close personalization"
            className="rounded px-2 text-subtle hover:text-fg"
          >
            ×
          </button>
        </header>

        <div className="space-y-5 px-4 py-4">
          <Field label="Theme">
            <div className="flex gap-1">
              {THEME_CYCLE.map((option) => (
                <Choice
                  key={option}
                  selected={mode === option}
                  testid={`pref-theme-${option}`}
                  onClick={() => setDraftMode(option)}
                >
                  {THEME_LABELS[option]}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="Font">
            <div className="grid grid-cols-2 gap-1">
              {FONT_CHOICES.map((option) => (
                <Choice
                  key={option}
                  selected={prefs.font === option}
                  testid={`pref-font-${option}`}
                  onClick={() => setPrefs((current) => ({ ...current, font: option }))}
                  // Each option is set in its own face: the name of a typeface tells you far
                  // less about it than one word of it does.
                  style={{ fontFamily: FONT_STACKS[option] }}
                >
                  {FONT_LABELS[option]}
                </Choice>
              ))}
            </div>
          </Field>

          <Field label="Size">
            <div className="flex gap-1">
              {FONT_SIZES.map((option) => (
                <Choice
                  key={option}
                  selected={prefs.size === option}
                  testid={`pref-size-${option}`}
                  onClick={() => setPrefs((current) => ({ ...current, size: option }))}
                >
                  {option}
                </Choice>
              ))}
            </div>
          </Field>

          {/* For when no page is open, so the dialog is never judged against nothing. */}
          <p
            data-testid="pref-sample"
            className="rounded-md border border-line bg-app px-3 py-2 text-fg"
            style={{
              fontFamily: FONT_STACKS[prefs.font],
              // Same rule as the editor in index.css: the chosen size, times the interface scale.
              fontSize: `calc(${prefs.size}px * var(--tendto-ui-scale, 1))`,
            }}
          >
            The quick brown fox jumps over the lazy dog.
          </p>
        </div>

        <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
          <button
            type="button"
            onClick={onClose}
            data-testid="pref-cancel"
            className="rounded border border-line px-2 py-1 text-xs text-muted hover:text-fg"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={save}
            disabled={!dirty}
            data-testid="pref-save"
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90 disabled:opacity-50"
          >
            Save
          </button>
        </footer>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-subtle">{label}</h3>
      {children}
    </section>
  );
}

function Choice({
  selected,
  testid,
  onClick,
  style,
  children,
}: {
  selected: boolean;
  testid: string;
  onClick: () => void;
  style?: React.CSSProperties;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testid}
      aria-pressed={selected}
      style={style}
      className={`flex-1 rounded border px-2 py-1.5 text-sm ${
        selected
          ? "border-fg bg-hover text-fg"
          : "border-line text-muted hover:bg-hover hover:text-fg"
      }`}
    >
      {children}
    </button>
  );
}
