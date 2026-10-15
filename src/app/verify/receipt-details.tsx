import Link from "next/link";
import type { ReactNode } from "react";
import type { ReceiptDetails } from "@/lib/report/public-verify.ts";

/**
 * What a verified receipt shows, shared by the receipt page (`/verify/<hash>`, server) and the
 * file check on `/verify` (browser). One component, so the two can never show different fields:
 * everything here is the receipt's allow-list (`buildReceipt`) and nothing else.
 */

export const CHIP = {
  pass: "border-pass-border bg-pass-surface text-pass-text",
  fail: "border-fail-border bg-fail-surface text-fail-text",
  warning: "border-warning-border bg-warning-surface text-warning-text",
  neutral: "border-dashed border-neutral-border bg-neutral-surface text-neutral-text",
} as const;

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 py-3 sm:grid-cols-[11rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-ink-faint">{label}</dt>
      <dd className="min-w-0 text-sm text-ink [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}

function stated(value: number | null): string {
  return value === null ? "not stated" : String(value);
}

export function ReceiptDetailsList({ details }: { details: ReceiptDetails }) {
  const { suite, counts, grade, chain } = details;
  return (
    <dl className="mt-6 divide-y divide-line border-y border-line">
      <Row label="Sealed at">{details.sealedAt ?? "Not recorded"}</Row>
      <Row label="Run date">{details.runDate ?? "Not stated in this report"}</Row>
      <Row label="Suite">
        {suite.builtIn
          ? <>{suite.name} <span className="font-mono text-ink-soft">({suite.key} v{suite.version})</span></>
          : suite.version !== null
            ? <>The workspace&apos;s own suite, version {suite.version}. Its name is not shown here.</>
            : "The workspace's own suite. Its name is not shown here."}
      </Row>
      <Row label="Grading funded by">{details.fundedBy ?? "Not stated in a form this page reads"}</Row>
      <Row label="Scenarios">
        {counts.planned === null ? "Not stated" : `${counts.planned} planned`}
        <span className="mt-1 block text-ink-soft">
          {stated(counts.passed)} passed · {stated(counts.failed)} failed · {stated(counts.noResult)} no result · {stated(counts.notRun)} not run
        </span>
      </Row>
      <Row label="Grade">
        {grade === null
          ? "Not recorded: this report's format predates grades."
          : grade.shownAs
            ? <>{grade.shownAs === "withheld" ? "Withheld" : "Incomplete"}{grade.threshold !== null ? <span className="text-ink-soft"> · pass mark {grade.threshold}%</span> : null}</>
            : <>{grade.band}{grade.score !== null ? ` · ${grade.score}%` : ""}{grade.threshold !== null ? <span className="text-ink-soft"> · pass mark {grade.threshold}%</span> : null}</>}
      </Row>
      <Row label="Previous report">
        {chain.kind === "previous"
          ? <Link href={`/verify/${chain.hash}`} className="font-mono underline underline-offset-2 break-all">{chain.hash}</Link>
          : chain.kind === "first"
            ? "None: this is the first report for its agent."
            : "Not recorded: this report's format predates the chain."}
      </Row>
      {details.reissueOf && (
        <Row label="Reissues">
          <Link href={`/verify/${details.reissueOf}`} className="font-mono underline underline-offset-2 break-all">{details.reissueOf}</Link>
        </Row>
      )}
      <Row label="Document format">{details.format === null ? "Not stated" : `Format ${details.format}`}</Row>
    </dl>
  );
}
