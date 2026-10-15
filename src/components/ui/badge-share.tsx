"use client";

import { useId, useRef, useState } from "react";
import { Button } from "./button.tsx";

/**
 * "Embed badge": the sealed report's badge (`/api/badge/<sha256>`), previewed, with the HTML
 * and Markdown that put it on a page linked to the public receipt.
 *
 * The same native `<dialog>` as the seal inspector: `showModal()` makes the page inert behind
 * it, Escape closes it, focus returns to the button, and a copy that the clipboard refuses
 * selects the snippet for the person instead. The snippets are built on the server
 * (`badgeSnippets`) from the same receipt the badge draws, so the alt text says what the
 * image says.
 *
 * Hidden in print: a printed report has no use for an embed code.
 */
export function BadgeShare({
  previewSrc,
  previewWidth,
  alt,
  html,
  markdown,
  className = "",
}: {
  /** Relative badge path, so the preview reads this deployment. */
  previewSrc: string;
  /** The badge's drawn width, so the preview holds its space before it loads. */
  previewWidth: number;
  alt: string;
  html: string;
  markdown: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [opened, setOpened] = useState(false);
  const [said, setSaid] = useState("");
  const titleId = useId();

  function open() {
    setOpened(true);
    setSaid("");
    dialog.current?.showModal();
  }

  function close() {
    dialog.current?.close();
  }

  async function copy(text: string, what: string, fallback: HTMLElement | null) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("no clipboard");
      await navigator.clipboard.writeText(text);
      setSaid(`Copied the ${what}.`);
    } catch {
      if (fallback) {
        const range = document.createRange();
        range.selectNodeContents(fallback);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
      }
      setSaid(`Could not copy automatically. The ${what} is selected: press Ctrl+C, or ⌘C on a Mac.`);
    }
  }

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={`print-hide inline-flex items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink ${className}`}
      >
        Embed badge
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        className="print-hide m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-panel border border-line bg-surface p-0 text-ink shadow-modal backdrop:bg-ink/40"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="type-h2">Embed this report&rsquo;s badge</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                The badge shows this sealed report and links to its public receipt. It is testing evidence, not a
                certification.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={close} className="shrink-0">Close</Button>
          </div>

          <section aria-labelledby={`${titleId}-preview`} className="mt-5">
            <h3 id={`${titleId}-preview`} className="text-sm font-semibold">Preview</h3>
            <div className="mt-2 rounded-control border border-line bg-sunken p-3">
              {opened ? (
                // An SVG from our own API at its drawn size, scaled down (never scrolled) on a
                // narrow screen; next/image adds nothing here.
                // eslint-disable-next-line @next/next/no-img-element
                <img src={previewSrc} alt={alt} width={previewWidth} height={28} className="block h-auto max-w-full" />
              ) : (
                <span className="block h-7" />
              )}
            </div>
          </section>

          <Snippet label="HTML" what="HTML snippet" text={html} onCopy={copy} />
          <Snippet label="Markdown" what="Markdown snippet" text={markdown} onCopy={copy} />
          <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-pass-text">{said}</p>
        </div>
      </dialog>
    </>
  );
}

function Snippet({ label, what, text, onCopy }: {
  label: string;
  what: string;
  text: string;
  onCopy: (text: string, what: string, fallback: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <section className="mt-4">
      <h3 className="text-sm font-semibold">{label}</h3>
      <div className="mt-2 rounded-control border border-line bg-sunken">
        <pre ref={ref} className="type-mono whitespace-pre-wrap [font-variant-ligatures:none] break-all p-3 text-xs leading-relaxed text-ink">{text}</pre>
        <div className="flex justify-end border-t border-line px-3 py-2">
          <Button variant="secondary" size="sm" onClick={() => onCopy(text, what, ref.current)}>Copy {label}</Button>
        </div>
      </div>
    </section>
  );
}
