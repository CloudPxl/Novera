import type { Readiness } from "@/lib/report/readiness.ts";

/**
 * What the run page offers for handing the result to a client, from stored rows only.
 *
 * A completed run with a sealed report whose link still answers gets the client deliverable
 * bar: the report itself (the one primary action), its link to copy, the report printed or
 * saved as PDF, the public seal check, and the comparison with the previous run. Nothing else
 * gets it:
 *
 *  - a run in flight or aborted has no report (an aborted run is never sealed);
 *  - a completed run with no sealed report, or an exploratory scan (never sealed, 0056), has
 *    nothing to hand over;
 *  - a withdrawn report is said to be withdrawn, with nothing to share — its link and exports
 *    refuse at once (0053); an expired one likewise.
 *
 * The bar never raises a report's readiness: it states the computed state beside the actions
 * (src/lib/report/readiness.ts), so "Review before sharing" stays visible right where the link
 * is copied. A report sealed from Novera's scripted fixture says so in the bar too.
 */

export type Deliverable =
  | { kind: "none" }
  | { kind: "withdrawn"; at: string }
  | { kind: "expired"; at: string }
  | {
      kind: "share";
      /** The client's document, `/report/<token>`: the bar's one primary action. */
      reportHref: string;
      /** The same document, opened to print: the report page is what prints, not the operator page. */
      printHref: string;
      /** The public seal check by SHA-256. */
      verifyHref: string;
      /** `/runs/compare?base=&target=` against the newest earlier comparable run, when there is one. */
      compareHref: string | null;
      readiness: Readiness | null;
      fixture: boolean;
    };

export function deliverableFor(input: {
  runId: string;
  runStatus: string;
  exploratory: boolean;
  fixture: boolean;
  report: { token: string; content_hash: string; revoked_at: string | null; expires_at: string } | null;
  readiness: Readiness | null;
  previousRunId: string | null;
  now?: Date;
}): Deliverable {
  const { report } = input;
  if (input.runStatus !== "completed" || input.exploratory || !report?.token || !report.content_hash) return { kind: "none" };
  if (report.revoked_at) return { kind: "withdrawn", at: report.revoked_at };
  if (new Date(report.expires_at) < (input.now ?? new Date())) return { kind: "expired", at: report.expires_at };
  const token = encodeURIComponent(report.token);
  return {
    kind: "share",
    reportHref: `/report/${token}`,
    printHref: `/report/${token}?print=1`,
    verifyHref: `/verify/${encodeURIComponent(report.content_hash)}`,
    compareHref: input.previousRunId ? `/runs/compare?base=${encodeURIComponent(input.previousRunId)}&target=${encodeURIComponent(input.runId)}` : null,
    readiness: input.readiness,
    fixture: input.fixture,
  };
}
