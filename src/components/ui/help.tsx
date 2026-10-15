"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The one "?" disclosure. `Help` (a sentence of your own) and `ExplainTrigger` (an entry of the
 * glossary) both render it, so a marker looks and behaves the same wherever it appears.
 *
 * A native `<details>`: it opens with a click, Enter or Space, needs no script, and a screen
 * reader announces it as expandable. The explanation flows below the marker rather than
 * floating over the page, so it can never push a 390px screen sideways (a transparent tooltip
 * that still took part in layout once did, 28px, on every page that used one). Put it in a
 * `flex flex-wrap items-baseline` row beside a heading or a figure — never inside a `<p>` or a
 * heading, where a `<details>` is not valid.
 *
 * The script adds one thing: Escape closes an open panel and returns focus to its marker.
 * Without script the panel still opens and closes.
 */
export function HelpDisclosure({ label, children }: { label: string; children: ReactNode }) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const el = details.current;
    if (!el) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented || !el.open) return;
      // Focus elsewhere (a dialog, a menu) is that control's Escape, not this panel's.
      const active = document.activeElement;
      if (active && active !== document.body && !el.contains(active)) return;
      // Handled here, so a dialog around the marker closes on the next press, not this one.
      event.preventDefault();
      el.open = false;
      el.querySelector("summary")?.focus();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <details ref={details} className="group print-hide inline-block align-middle">
      <summary
        aria-label={`What is this? ${label}`}
        title={`What is this? ${label}`}
        className="group/mark -my-1 ml-1 inline-flex size-6 cursor-pointer list-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-ink [&::-webkit-details-marker]:hidden"
      >
        <span
          aria-hidden
          className="grid size-5 place-items-center rounded-full border border-line-strong text-[11px] font-semibold leading-none text-ink-soft group-hover/mark:bg-sunken group-open:bg-sunken"
        >
          ?
        </span>
      </summary>
      <span className="mt-2 block max-w-prose space-y-2 rounded-lg border border-line bg-sunken px-3 py-2 text-sm font-normal leading-relaxed tracking-normal text-ink-soft">
        {children}
      </span>
    </details>
  );
}

/** A "?" beside a heading or a figure that explains it in a sentence or two of your own. */
export function Help({ label, children }: { label: string; children: ReactNode }) {
  return <HelpDisclosure label={label}>{children}</HelpDisclosure>;
}
