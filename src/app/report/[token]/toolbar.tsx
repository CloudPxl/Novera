"use client";

/**
 * What a person can do with the document they are looking at.
 *
 * Markdown and CSV exports have existed since the report did, behind the same token
 * gate, and nothing on the page said so — a capability nobody can find is one that is
 * not there. Print is the third, because print-to-PDF is how this document gets
 * attached to an email, and a reader should not have to guess that the page was built
 * to survive it.
 *
 * Hidden when printing: a toolbar in a filed document is noise, and "Print" printed on
 * a printout is worse than noise.
 */
export function ReportToolbar({ token }: { token: string }) {
  const link =
    "rounded-control border border-line-strong px-3 py-1.5 text-xs font-medium text-ink-soft "
    + "transition-colors hover:border-ink hover:text-ink focus-visible:outline-2 "
    + "focus-visible:outline-offset-2 focus-visible:outline-ink";

  return (
    <div className="print-hide flex flex-wrap items-center gap-2">
      <a className={link} href={`/api/reports/${token}/export?format=md`} download>
        Markdown
      </a>
      <a className={link} href={`/api/reports/${token}/export?format=csv`} download>
        CSV
      </a>
      <button type="button" className={link} onClick={() => window.print()}>
        Print or save as PDF
      </button>
    </div>
  );
}
