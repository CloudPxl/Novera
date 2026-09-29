/**
 * A report reissued to disclose what people found when they reviewed its verdicts.
 *
 * Reports are sealed the moment a run completes, so no review can exist before the
 * seal — and a sealed document cannot be edited, which is what its hash proves. A
 * review therefore reaches a client only as a *new* document: the original payload,
 * carried unchanged, with one section added and a pointer back to the report it
 * reissues. The two can be compared line by line, and the original keeps verifying.
 *
 * Nothing here recomputes a verdict, a count, a grade or a score. The people reviewing
 * are members of the workspace whose agent was tested; their reading is stated beside
 * the automated one, never in place of it.
 */
import type { ReportPayload } from "./payload.ts";
import { contentHash, type Json } from "./hash.ts";
import { assertPublishable } from "./redact.ts";
import {
  alignment,
  latestReviews,
  withFindingsApplied,
  type VerdictReview,
} from "../evidence/reviews.ts";

export const REVIEWED_BY = "Members of the workspace whose agent was tested";

const HUMAN_REVIEW_NOTE =
  "After this run was graded, members of the workspace whose agent was tested reviewed some of its verdicts. Their findings are listed with the reason each gave. They change no verdict, count, grade or score in this report: the reviewers are the tested party, not an independent assessor, so their reading is shown beside the automated one and never in place of it.";

const REISSUE_LIMITATION =
  "This document reissues an earlier report for the same run to disclose human review. Every section before the human review is carried from that report unchanged except the chain to the previous report; the earlier report's hash is stated so the two can be compared.";

export class NothingToDisclose extends Error {
  constructor() {
    super("No verdict on this run has been reviewed since its latest report was issued.");
  }
}

export function reissueWithReview(args: {
  original: ReportPayload;
  originalHash: string;
  /** The latest report for this agent, which is what the new document chains to. */
  previousReportHash: string | null;
  /** Every stored case of the run: the figure with findings applied is over all of them. */
  cases: Array<{ runCaseId: string; caseId: string; status: "pass" | "fail" | "error" }>;
  reviews: VerdictReview[];
  asOf: string;
  /** Checked verbatim, as at the original seal: a reviewer's note may quote the policy. */
  privateMaterial: string[];
}): { payload: ReportPayload; contentHash: string } {
  const latest = latestReviews(args.reviews);
  if (latest.size === 0) throw new NothingToDisclose();

  const caseIdOf = new Map(args.cases.map((c) => [c.runCaseId, c.caseId]));
  const counts = alignment(latest.values());
  const applied = withFindingsApplied(args.cases, latest);

  const findings = [...latest.values()]
    .filter((r) => r.verdictStatus === "error" || r.verdictStatus !== r.finding)
    .map((r) => ({
      case_id: caseIdOf.get(r.runCaseId) ?? "unknown",
      verdict: r.verdictStatus,
      finding: r.finding,
      note: r.note,
      reviewed_at: r.createdAt,
    }))
    .sort((a, b) => a.case_id.localeCompare(b.case_id));

  const payload: ReportPayload = {
    ...args.original,
    // At least 11, the reissue format, and never lower than what the original carries:
    // a reissued format-12 report still states what was tested.
    novera: { format: Math.max(args.original.novera.format, 11) },
    run: { ...args.original.run, previous_report_hash: args.previousReportHash },
    human_review: {
      reviewed_by: REVIEWED_BY,
      as_of: args.asOf,
      reviewed: latest.size,
      agreed: counts.agreed,
      disagreed: counts.disagreed,
      resolved_gaps: counts.resolvedGaps,
      findings,
      with_findings_applied: {
        passed: applied.passed,
        failed: applied.failed,
        no_verdict: applied.noVerdict,
        changed: applied.changed,
      },
      note: HUMAN_REVIEW_NOTE,
    },
    reissue: { of: args.originalHash, reason: "human_review" },
    // A reissue of a reissue already carries the sentence; saying it twice would read
    // as two separate disclosures.
    limitations: args.original.limitations.includes(REISSUE_LIMITATION)
      ? args.original.limitations
      : `${args.original.limitations} ${REISSUE_LIMITATION}`,
  };

  assertPublishable(payload as unknown as Json, args.privateMaterial);
  return { payload, contentHash: contentHash(payload as unknown as Json) };
}
