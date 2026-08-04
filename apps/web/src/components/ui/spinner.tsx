/** Minimal, calm loading primitives. Tailwind-only; no dependency on a component library. */

interface SpinnerProps {
  label?: string;
  className?: string;
}

export function Spinner({ label, className }: SpinnerProps) {
  return (
    <div className={`flex items-center gap-3 text-sm text-muted ${className ?? ""}`}>
      <span
        aria-hidden
        className="h-4 w-4 animate-spin rounded-full border-2 border-line border-t-muted"
      />
      {label ? <span>{label}</span> : null}
    </div>
  );
}

export function FullScreenLoader({ label }: { label?: string }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-app">
      <Spinner label={label} />
    </div>
  );
}
