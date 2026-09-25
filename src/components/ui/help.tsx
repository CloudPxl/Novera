/**
 * A "?" beside a heading or a figure that explains it in a sentence or two.
 *
 * A native `<details>`: it opens with a click, Enter or Space, needs no script, and a
 * screen reader announces it as expandable. The explanation flows below the marker
 * rather than floating over the page, so it can never push a 390px screen sideways.
 */
export function Help({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <details className="group inline-block align-middle">
      <summary
        aria-label={`What is this? ${label}`}
        title={`What is this? ${label}`}
        className="ml-1.5 inline-flex h-5 w-5 cursor-pointer list-none items-center justify-center rounded-full border border-line-strong text-[11px] font-semibold leading-none text-ink-soft outline-none hover:bg-sunken focus-visible:ring-2 focus-visible:ring-ink [&::-webkit-details-marker]:hidden"
      >
        ?
      </summary>
      <span className="mt-2 block max-w-prose rounded-lg border border-line bg-sunken px-3 py-2 text-sm font-normal leading-relaxed tracking-normal text-ink-soft">
        {children}
      </span>
    </details>
  );
}
