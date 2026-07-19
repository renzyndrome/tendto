/**
 * Segmented control — the Meadow pill toggle used for view switcher (Board/Table/List),
 * Density, and Editor width. Active segment is a white pill with a subtle shadow.
 */
export interface SegmentOption<T extends string> {
  value: T;
  label: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel?: string;
  className?: string;
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className = "",
}: SegmentedControlProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`inline-flex rounded-input border border-border-soft bg-panel p-[3px] ${className}`}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={
              "rounded-md px-3.5 py-1 text-xs transition-colors " +
              (active
                ? "bg-surface font-medium text-ink shadow-segment"
                : "text-muted hover:text-ink")
            }
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
