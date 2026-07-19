/**
 * Modal shell — dimmed (optionally blurred) backdrop + centered card. Used by the welcome dialog.
 * Escape and backdrop-click call onClose when `dismissible`. Focus is trapped lightly by moving
 * initial focus into the card.
 */
import { type ReactNode, useEffect, useRef } from "react";

interface ModalProps {
  children: ReactNode;
  onClose?: () => void;
  dismissible?: boolean;
  labelledBy?: string;
  className?: string;
  width?: number;
}

export function Modal({
  children,
  onClose,
  dismissible = true,
  labelledBy,
  className = "",
  width = 440,
}: ModalProps) {
  const cardRef = useRef<HTMLDivElement>(null);

  // Focus the card ONCE on mount. (Must not depend on onClose — that's a fresh closure each parent
  // render, and re-running this would steal focus back from an input on every keystroke.)
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  // Escape to close — safe to re-subscribe when onClose changes (it never touches focus).
  useEffect(() => {
    if (!dismissible || !onClose) return;
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onClose?.();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dismissible, onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[rgba(31,29,24,.28)] p-4 backdrop-blur-[2px]"
      onClick={() => dismissible && onClose?.()}
    >
      <div
        ref={cardRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ width }}
        className={
          "max-w-full animate-pop-in overflow-hidden rounded-modal bg-surface shadow-modal outline-none " +
          className
        }
      >
        {children}
      </div>
    </div>
  );
}
