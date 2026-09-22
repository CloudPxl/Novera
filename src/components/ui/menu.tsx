"use client";

import { useEffect, useId, useRef, useState, type ReactNode } from "react";

/**
 * A dropdown that closes the way people expect it to.
 *
 * `<details>` would have been free, but it traps nobody and ignores Escape, and
 * the top bar's menus sit over a page where a stray click is a state change. So:
 * Escape closes and returns focus to the trigger, a click outside closes, and the
 * trigger carries `aria-expanded` so a screen reader is told the same thing the
 * chevron says.
 */
export function Menu({
  label,
  children,
  align = "right",
  className = "",
  triggerClassName = "",
  panelClassName = "",
}: {
  label: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  className?: string;
  triggerClassName?: string;
  panelClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;

    function onKey(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        trigger.current?.focus();
      }
    }
    function onPointer(event: MouseEvent) {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [open]);

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={trigger}
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-controls={open ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-control text-sm font-medium transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ink ${triggerClassName}`}
      >
        {label}
        <svg aria-hidden viewBox="0 0 12 12" className={`size-3 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}>
          <path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          id={panelId}
          role="menu"
          className={`novera-panel-in absolute top-[calc(100%+0.375rem)] z-40 min-w-56 overflow-hidden rounded-panel border border-line bg-surface p-1 shadow-modal ${
            align === "right" ? "right-0" : "left-0"
          } ${panelClassName}`}
        >
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      )}
    </div>
  );
}

export const menuItemClass =
  "block w-full rounded-control px-3 py-2 text-left text-sm text-ink transition-colors hover:bg-sunken focus-visible:bg-sunken outline-none";
