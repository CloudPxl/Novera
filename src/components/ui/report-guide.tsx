import Link from "next/link";
import type { ReportGuide } from "@/lib/explainability/report-guide.ts";

/**
 * The 60-second guide (src/lib/explainability/report-guide.ts), drawn twice:
 *
 *  - on screen, a native `<details>` closed by default — it opens without script, and a reader
 *    who already knows the words loses one line;
 *  - on paper (`print`), a compact four-entry legend, because a printed report is read by someone
 *    who cannot open a disclosure or follow a link. No `?` markers, no links on paper.
 *
 * Outside the sealed content, like the standing notice: nothing here is part of a payload.
 */
export function ReportGuideBox({ guide, print = false, className = "" }: { guide: ReportGuide; print?: boolean; className?: string }) {
  return (
    <>
      <details className={`group print-hide rounded-panel border border-line bg-surface ${className}`}>
        <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-panel px-4 py-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ink [&::-webkit-details-marker]:hidden">
          <span className="font-medium text-ink">{guide.summary}</span>
          <span aria-hidden className="text-ink-faint transition-transform duration-200 group-open:rotate-90">›</span>
        </summary>
        <div className="border-t border-line px-4 py-4 text-sm leading-relaxed text-ink-soft">
          <dl className="max-w-prose space-y-4">
            {guide.parts.map((part) => (
              <div key={part.id} className="min-w-0">
                <dt className="font-semibold text-ink">{part.title}</dt>
                {part.paragraphs.map((p) => (
                  <dd key={p.slice(0, 40)} className="mt-1 [overflow-wrap:anywhere]">{p}</dd>
                ))}
              </div>
            ))}
          </dl>
          <p className="mt-4 border-t border-line pt-3 text-ink">{guide.scope}</p>
          <p className="mt-2">
            <Link href={guide.docsHref} className="font-medium text-ink underline underline-offset-2">
              Reading a report, in plain words
            </Link>
          </p>
        </div>
      </details>

      {print && (
        <div className={`hidden rounded-panel border border-line px-4 py-3 text-xs leading-relaxed text-ink-soft print:block ${className}`}>
          <p className="font-semibold text-ink">How to read this report</p>
          <ul className="mt-1.5 space-y-1">
            {guide.legend.map((l) => (
              <li key={l.term}>
                <strong className="font-semibold text-ink">{l.term}.</strong> {l.text}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}
