import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { Badge } from "@/components/ui/primitives.tsx";
import { REPORT_NOTICE_SHORT } from "@/lib/legal/notices.ts";
import { READINESS_LABEL, type Readiness } from "@/lib/report/readiness.ts";
import { CopyLink } from "./copy-link.tsx";
import type { Deliverable } from "./deliverable.ts";

const READY_TONE: Record<Readiness, "pass" | "neutral" | "error" | "fail"> = {
  READY_TO_SHARE: "pass", READY_FOR_INTERNAL_REVIEW: "neutral", INCOMPLETE: "error", WITHHELD: "error",
  BLOCKED_BY_EVIDENCE: "fail", REVOKED: "neutral", EXPIRED: "neutral",
};

const utc = (at: string) => `${at.slice(0, 16).replace("T", " ")} UTC`;

/**
 * The client deliverable, at the Decide level of a finished run: one primary action (the
 * client's report) and its quieter neighbours, each appearing once on the page. What it offers
 * is decided by `deliverableFor` (deliverable.ts) from stored rows; a withdrawn or expired
 * report is stated, with nothing to share.
 *
 * Printing is the report's job, not this page's: "Print / save PDF" opens the client report,
 * which carries its own print styles and the seal it was printed with, and asks the browser to
 * print it there. The operator page still prints (its sections and seal line) from the
 * browser's own menu, for an internal file.
 */
export function DeliverableBar({ deliverable, extra }: {
  deliverable: Deliverable;
  /** Exports and the badge: secondary, after the four actions. */
  extra?: ReactNode;
}) {
  if (deliverable.kind === "none") return null;
  if (deliverable.kind !== "share") {
    return (
      <section aria-labelledby="deliverable-heading" className="print-hide mt-4 rounded-shell border border-line bg-surface px-5 py-4">
        <h2 id="deliverable-heading" className="text-sm font-medium">
          {deliverable.kind === "withdrawn" ? "This report was withdrawn" : "This report's link has expired"}
        </h2>
        <p className="mt-1 text-sm text-ink-soft">
          {deliverable.kind === "withdrawn"
            ? `Withdrawn ${utc(deliverable.at)}. Its link and every download stopped answering for everyone who has them, so there is nothing here to share. A new run gives a new report.`
            : `Expired ${utc(deliverable.at)}. Its link and downloads no longer answer, so there is nothing here to share. A new run gives a new report.`}
        </p>
      </section>
    );
  }

  const d = deliverable;
  return (
    <section aria-labelledby="deliverable-heading" className="print-hide mt-4 rounded-shell border border-line bg-surface px-5 py-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 id="deliverable-heading" className="text-sm font-medium">Client report</h2>
        {d.readiness && <Badge tone={READY_TONE[d.readiness]}>{READINESS_LABEL[d.readiness]}</Badge>}
        {d.fixture && <Badge tone="high">Test data: Novera&apos;s scripted fixture</Badge>}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <ButtonLink href={d.reportHref}>View client report</ButtonLink>
        <CopyLink path={d.reportHref} />
        <ButtonLink href={d.printHref} target="_blank" rel="noreferrer" variant="secondary" size="sm" aria-describedby="deliverable-print-hint">
          Print / save PDF
        </ButtonLink>
        <ButtonLink href={d.verifyHref} variant="secondary" size="sm">Verify seal</ButtonLink>
        {d.compareHref && <ButtonLink href={d.compareHref} variant="secondary" size="sm">Compare with previous run</ButtonLink>}
        {extra}
      </div>
      <p id="deliverable-print-hint" className="mt-3 text-xs leading-relaxed text-ink-faint">
        Printing opens the client report in a new tab and asks your browser to print it; choose &ldquo;Save as PDF&rdquo; there for a file.
      </p>
      {/* Said where the link is handed on, as well as on the report itself. */}
      <p className="mt-1 text-xs leading-relaxed text-ink-faint">{REPORT_NOTICE_SHORT}</p>
    </section>
  );
}
