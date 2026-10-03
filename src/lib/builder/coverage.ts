import type { SuiteCase } from "../runner/types.ts";

/**
 * Where a build stands, counted from its rows. The page's summary line and the publish
 * gate read the same function, so the screen cannot call a suite complete that the
 * database would refuse to publish.
 */

export type CandidateStatus = "draft" | "needs_review" | "approved" | "rejected" | "not_applicable" | "included";

export interface CandidateRow {
  id: string;
  origin: string;
  status: CandidateStatus;
  scenario: SuiteCase;
  conflicts: unknown[];
  obligation_id: string | null;
  source_ref: { pack_key?: string } | null;
  edited_from: string | null;
  destructive: boolean;
}

export interface ObligationRow {
  id: string;
  status: "drafted" | "open" | "answered" | "not_applicable";
  flags: unknown[];
}

export interface BuildCoverage {
  total: number;
  approved: number;
  /** Waiting for a decision a person has not made: drafts and those needing review. */
  undecided: number;
  needsReview: number;
  openQuestions: number;
  conflicts: number;
  rejected: number;
  notApplicable: number;
  /** Approved scenarios that come from a pack and nothing of the customer's. */
  baselineOnly: number;
  /** Approved scenarios that claim an action and would need tool activity to settle it. */
  missingToolReceipts: number;
  /** Candidates a bulk approval may decide: low or medium, no question, no conflict. */
  bulkEligible: number;
  /** Nothing undecided, no open question, at least one approved. */
  readyToPublish: boolean;
}

export function bulkEligible(c: CandidateRow, obligations: Map<string, ObligationRow>): boolean {
  if (c.status !== "draft" || c.destructive || c.scenario.destructive) return false;
  if (c.conflicts.length) return false;
  if (c.scenario.severity !== "low" && c.scenario.severity !== "medium") return false;
  const ob = c.obligation_id ? obligations.get(c.obligation_id) : null;
  if (ob && (ob.status === "open" || ob.status === "not_applicable" || ob.flags.length)) return false;
  return true;
}

export function buildCoverage(args: {
  candidates: CandidateRow[];
  obligations: ObligationRow[];
  /** Whether the build's agent reports tool activity. Null when no agent is chosen. */
  agentReportsTools: boolean | null;
}): BuildCoverage {
  const obligations = new Map(args.obligations.map((o) => [o.id, o]));
  const live = args.candidates;
  const approved = live.filter((c) => c.status === "approved" || c.status === "included");
  const undecided = live.filter((c) => c.status === "draft" || c.status === "needs_review");
  const openQuestions = args.obligations.filter((o) => o.status === "open").length;
  const needsAction = (c: SuiteCase) => c.effect?.evidence === "tool_invoked" || (c.checks ?? []).some((k) => k.type === "tool_required" || k.type === "tool_order");

  return {
    total: live.length,
    approved: approved.length,
    undecided: undecided.length,
    needsReview: live.filter((c) => c.status === "needs_review").length,
    openQuestions,
    conflicts: undecided.filter((c) => c.conflicts.length > 0).length + approved.filter((c) => c.conflicts.length > 0).length,
    rejected: live.filter((c) => c.status === "rejected").length,
    notApplicable: live.filter((c) => c.status === "not_applicable").length,
    baselineOnly: approved.filter((c) => c.origin === "pack" && !c.edited_from).length,
    missingToolReceipts: args.agentReportsTools === false ? approved.filter((c) => needsAction(c.scenario)).length : 0,
    bulkEligible: live.filter((c) => bulkEligible(c, obligations)).length,
    readyToPublish: approved.length > 0 && undecided.length === 0 && openQuestions === 0,
  };
}
