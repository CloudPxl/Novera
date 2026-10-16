"use client";

import { useRef, useState } from "react";
import { buttonClass } from "@/components/ui/button-link.tsx";

/**
 * Copies the client report's address — this deployment's origin and the report's path, the
 * same link "View client report" opens. Without `navigator.clipboard` (an insecure origin, an
 * old browser) the address is shown selected, so the person can copy it themselves. The result
 * is announced in a live region; the button's own name never changes.
 */
export function CopyLink({ path }: { path: string }) {
  const [said, setSaid] = useState("");
  const [shown, setShown] = useState<string | null>(null);
  const field = useRef<HTMLInputElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  async function copy() {
    const url = new URL(path, window.location.origin).toString();
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(url);
      setShown(null);
      setSaid("Link copied.");
    } catch {
      setShown(url);
      setSaid("Could not copy automatically. The link is selected: press Ctrl+C, or ⌘C on a Mac.");
      requestAnimationFrame(() => field.current?.select());
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setSaid(""), 4000);
  }

  return (
    <>
      <button type="button" onClick={copy} className={buttonClass("secondary", "sm")}>Copy link</button>
      {shown && (
        <input ref={field} readOnly value={shown} aria-label="Client report link" onFocus={(e) => e.currentTarget.select()}
          className="w-full min-w-0 rounded-control border border-line-strong bg-surface px-2 py-1 type-mono text-xs text-ink sm:w-80" />
      )}
      <span role="status" aria-live="polite" className="text-xs font-medium text-ink-soft">{said}</span>
    </>
  );
}
