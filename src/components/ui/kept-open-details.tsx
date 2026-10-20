"use client";

import { useState, type ReactNode } from "react";

/**
 * A `<details>` whose first state comes from the server and is then the person's. A server
 * component's `open={…}` is re-applied on every refresh, so a form inside one disappeared the
 * moment its own success changed the condition — "Record a failure" closed over its "Recorded,
 * and drafted as R01" the first time (Round 2 audit, 2026-10-19).
 */
export function KeptOpenDetails({ initiallyOpen, className, children }: { initiallyOpen: boolean; className?: string; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <details open={open} onToggle={(e) => setOpen(e.currentTarget.open)} className={className}>
      {children}
    </details>
  );
}
