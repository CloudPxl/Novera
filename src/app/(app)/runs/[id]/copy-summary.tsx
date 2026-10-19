"use client";

import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-link.tsx";

/**
 * Copies the plain-text client summary (`src/lib/report/client-summary.ts`), built on the server
 * from the sealed report. Without a clipboard the text is shown selected instead, as Copy link
 * does; the result is announced in a live region.
 */
export function CopySummary({ text }: { text: string }) {
  const [said, setSaid] = useState("");
  const [shown, setShown] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setShown(false);
      setSaid("Client summary copied.");
    } catch {
      setShown(true);
      setSaid("Could not copy automatically. The summary is selected: press Ctrl+C, or ⌘C on a Mac.");
      requestAnimationFrame(() => field.current?.select());
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(""), 4000);
  }

  return (
    <>
      <button type="button" onClick={copy} className={`print:hidden ${buttonClass("secondary", "sm")}`}>Copy client summary</button>
      {shown && (
        <textarea ref={field} readOnly value={text} rows={8} aria-label="Client summary" onFocus={(e) => e.currentTarget.select()}
          className="w-full rounded-control border border-line-strong bg-surface px-2 py-1 type-mono text-xs text-ink" />
      )}
      <span role="status" aria-live="polite" className="sr-only">{said}</span>
    </>
  );
}
