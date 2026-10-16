"use client";

import { useId, useRef, useState } from "react";
import { Button } from "./button.tsx";
import { Explained, ExplainProvider, type ExplainEntries } from "./explain-context.tsx";
import { SEAL_EXCLUDES, verifyFromFile, verifyFromLink, type SealItem } from "@/lib/report/seal.ts";

/**
 * The report's seal as a button, and what it covers in a dialog.
 *
 * A native `<dialog>` opened with `showModal()`: the rest of the page is inert while it is
 * open (the focus trap), Escape closes it, and focus goes back to the badge. Everything the
 * dialog says comes from the sealed payload (`sealContents`) or the stored hash; the command
 * it prints is the one tests/seal.test.ts runs against `contentHash`.
 *
 * Hidden in print: the printed page carries the full hash in its own header and footer.
 */
/** `explain`: `explainEntries(CLIENT_EXPLAINS.sealInspector)`, resolved by the server page that renders it. */
export function SealInspector({
  explain,
  ...props
}: SealInspectorProps & { explain: ExplainEntries }) {
  return (
    <ExplainProvider entries={explain}>
      <SealInspectorBody {...props} />
    </ExplainProvider>
  );
}

interface SealInspectorProps {
  hash: string;
  items: SealItem[];
  /** The JSON export's path while the link answers; null once withdrawn or expired. */
  exportPath: string | null;
  /** Why the export no longer answers, when `exportPath` is null. */
  unavailable?: string;
  className?: string;
}

function SealInspectorBody({
  hash,
  items,
  exportPath,
  unavailable,
  className = "",
}: SealInspectorProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const hashText = useRef<HTMLElement>(null);
  const [origin, setOrigin] = useState("");
  const [said, setSaid] = useState("");
  const titleId = useId();

  function open() {
    setOrigin(window.location.origin);
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
      // No clipboard (an insecure origin, a refused permission): select it for the person.
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

  const short = `${hash.slice(0, 8)}…${hash.slice(-6)}`;
  const linkCommand = exportPath && origin ? verifyFromLink(`${origin}${exportPath}`) : null;
  const fileCommand = verifyFromFile("report.json");

  return (
    <>
      <button
        ref={trigger}
        type="button"
        onClick={open}
        aria-haspopup="dialog"
        className={`print-hide inline-flex max-w-full items-center gap-2 rounded-control border border-line-strong bg-surface px-3 py-1.5 text-xs font-medium text-ink-soft transition-colors hover:border-ink hover:text-ink ${className}`}
      >
        <span aria-hidden className="size-1.5 shrink-0 rounded-full bg-ink" />
        <span>Sealed</span>
        <span className="type-mono truncate text-ink">SHA-256 {short}</span>
        <span className="sr-only">: what the seal covers and how to check it</span>
      </button>

      <dialog
        ref={dialog}
        aria-labelledby={titleId}
        onClose={() => trigger.current?.focus()}
        // A click on the backdrop lands on the dialog element itself.
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
        className="print-hide m-auto max-h-[calc(100dvh-2rem)] w-[min(40rem,calc(100vw-2rem))] overflow-y-auto rounded-panel border border-line bg-surface p-0 text-ink shadow-modal backdrop:bg-ink/40"
      >
        <div className="p-5 sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h2 id={titleId} className="type-h2">The seal on this report</h2>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                A SHA-256 digest of the report&rsquo;s sealed content. Change one figure or one word in it
                and the digest no longer matches. It records what was tested; it is not a certification.
              </p>
            </div>
            <Button variant="secondary" size="sm" onClick={close} className="shrink-0">Close</Button>
          </div>

          <section aria-labelledby={`${titleId}-hash`} className="mt-5">
            <div className="flex flex-wrap items-baseline">
              <h3 id={`${titleId}-hash`} className="text-sm font-semibold">SHA-256</h3>
              <Explained id="sha256_seal" />
            </div>
            <div className="mt-2 flex flex-wrap items-start gap-2 rounded-control bg-sunken p-3">
              <code ref={hashText} className="type-mono min-w-0 flex-1 break-all text-xs text-ink">{hash}</code>
              <Button variant="secondary" size="sm" onClick={() => copy(hash, "hash", hashText.current)}>Copy hash</Button>
            </div>
            <p role="status" aria-live="polite" className="mt-2 min-h-5 text-xs font-medium text-pass-text">{said}</p>
          </section>

          <section aria-labelledby={`${titleId}-covers`} className="mt-4">
            <h3 id={`${titleId}-covers`} className="text-sm font-semibold">What the seal covers</h3>
            <dl className="mt-2 divide-y divide-line rounded-control border border-line">
              {items.map((item) => (
                <div key={item.label} className="grid gap-0.5 px-3 py-2 text-sm sm:grid-cols-[10rem_minmax(0,1fr)] sm:gap-3">
                  <dt className="font-medium text-ink">{item.label}</dt>
                  <dd className="min-w-0 break-words leading-relaxed text-ink-soft">{item.detail}</dd>
                </div>
              ))}
            </dl>
            <h3 className="mt-4 text-sm font-semibold">Not covered by it</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-ink-soft">
              {SEAL_EXCLUDES.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </section>

          <section aria-labelledby={`${titleId}-verify`} className="mt-5">
            <h3 id={`${titleId}-verify`} className="text-sm font-semibold">Check it yourself</h3>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">
              The digest is SHA-256 over the <code className="type-mono text-xs">payload</code> of this report&rsquo;s
              JSON export, written with object keys sorted, no spaces and arrays in order. This command (Node.js 18 or
              later) recomputes it without trusting Novera; it should print the hash above.
            </p>
            {linkCommand ? (
              <Command text={linkCommand} label="command" onCopy={copy} />
            ) : (
              <p className="mt-2 text-sm leading-relaxed text-warning-text">
                {unavailable ?? "This report's link no longer answers, so its export cannot be fetched."} A JSON export
                downloaded earlier can still be checked with the command below.
              </p>
            )}
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              On a JSON export you have downloaded, saved as <code className="type-mono text-xs">report.json</code> (works
              offline, and after the link expires):
            </p>
            <Command text={fileCommand} label="offline command" onCopy={copy} />
          </section>
        </div>
      </dialog>
    </>
  );
}

/** Ligatures off: the code face draws `=>` and `!==` as arrows and symbols nobody can type. */
function Command({ text, label, onCopy }: {
  text: string;
  label: string;
  onCopy: (text: string, what: string, fallback: HTMLElement | null) => void;
}) {
  const ref = useRef<HTMLPreElement>(null);
  return (
    <div className="mt-2 rounded-control border border-line bg-sunken">
      <pre ref={ref} className="type-mono whitespace-pre-wrap [font-variant-ligatures:none] break-all p-3 text-xs leading-relaxed text-ink">{text}</pre>
      <div className="flex justify-end border-t border-line px-3 py-2">
        <Button variant="secondary" size="sm" onClick={() => onCopy(text, label, ref.current)}>Copy {label}</Button>
      </div>
    </div>
  );
}
