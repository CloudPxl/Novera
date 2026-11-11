import type { DiagnosticReport } from "./diagnostics.ts";
import { checkVerdict, verdictWords, type CheckVerdict } from "../checks/single.ts";

/**
 * "Resolve no results": what a completed run's no-result scenarios need, read from their
 * diagnoses, and what the retests then showed, read from `case_retests` rows. Pure, so the
 * page, the route and the tests agree.
 *
 * A retest never changes the run or its report (0072): it answers one question — was this
 * gap transient, or does something need fixing first — one scenario at a time, so a person
 * does not have to read a diagnosis per case or rerun the whole suite to find out.
 */
export interface ResolveItem {
  runCaseId: string;
  scenarioId: string;
  category: DiagnosticReport["category"];
  headline: string;
  /** The one thing to do, and who does it, for a scenario that is not safe to retest. */
  step: string;
  owner: DiagnosticReport["userAction"]["owner"];
  /** How long to wait before a retest is worth sending. */
  delayMs: number;
  /** Why a retest would only repeat the same answer, when it would. */
  blocked: string | null;
}

export interface ResolvePlan {
  retestable: ResolveItem[];
  fixFirst: ResolveItem[];
}

export function resolvePlan(cases: ReadonlyArray<{ runCaseId: string; scenarioId: string; status: string; diagnostic: DiagnosticReport | null }>): ResolvePlan {
  const plan: ResolvePlan = { retestable: [], fixFirst: [] };
  for (const c of cases) {
    if (c.status !== "error" || !c.diagnostic) continue;
    const d = c.diagnostic;
    const item: ResolveItem = {
      runCaseId: c.runCaseId,
      scenarioId: c.scenarioId,
      category: d.category,
      headline: d.headline,
      step: d.userAction.steps[0] ?? "",
      owner: d.userAction.owner,
      delayMs: d.retryPolicy.recommendedDelayMs,
      blocked: d.retryPolicy.isSafeToRetry ? null : d.retryPolicy.reasonIfBlocked,
    };
    (d.retryPolicy.isSafeToRetry ? plan.retestable : plan.fixFirst).push(item);
  }
  return plan;
}

export interface RetestRow {
  run_case_id: string | null;
  status: string;
  judge_agreement?: string | null;
  evidence_gap?: string | null;
  rationale?: string | null;
  error?: string | null;
  created_at: string;
}

export interface ResolveOutcome {
  runCaseId: string;
  scenarioId: string;
  /** Null until a retest recorded since the panel opened exists for this scenario. */
  verdict: CheckVerdict | null;
  words: string;
  detail: string | null;
  at: string | null;
}

/** The newest retest of each retestable scenario recorded at or after `since`; progress is derived, never kept. */
export function resolveOutcomes(plan: ResolvePlan, retests: ReadonlyArray<RetestRow>, since: string): ResolveOutcome[] {
  return plan.retestable.map((item) => {
    const mine = retests
      .filter((r) => r.run_case_id === item.runCaseId && r.created_at >= since)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const newest = mine[0];
    if (!newest) return { runCaseId: item.runCaseId, scenarioId: item.scenarioId, verdict: null, words: "Not retested yet", detail: null, at: null };
    const { verdict, noVerdictReason } = checkVerdict({ status: newest.status, judge_agreement: newest.judge_agreement ?? null, evidence_gap: newest.evidence_gap ?? null });
    // The check's own words (src/lib/checks/single.ts); only the first letter changes, so "AI" stays "AI".
    const words = verdictWords(verdict, noVerdictReason);
    return {
      runCaseId: item.runCaseId,
      scenarioId: item.scenarioId,
      verdict,
      words: `Retest: ${words.charAt(0).toLowerCase()}${words.slice(1)}`,
      detail: newest.rationale ?? newest.error ?? null,
      at: newest.created_at,
    };
  });
}

/** One sentence a person can act on, from the outcomes and the plan. Nothing in it claims the report changed. */
export function resolveSummary(outcomes: ReadonlyArray<ResolveOutcome>, plan: ResolvePlan): string {
  const retested = outcomes.filter((o) => o.verdict !== null);
  const transient = retested.filter((o) => o.verdict === "pass" || o.verdict === "fail").length;
  const stillNone = retested.length - transient;
  const pending = outcomes.length - retested.length;
  const parts: string[] = [];
  if (retested.length) {
    parts.push(`${transient} of ${retested.length} retested scenario${retested.length === 1 ? "" : "s"} reached a verdict, so ${transient === 1 ? "that gap was" : "those gaps were"} transient`);
    if (stillNone) parts.push(`${stillNone} still produced no result`);
  }
  if (pending) parts.push(`${pending} not retested yet`);
  if (plan.fixFirst.length) parts.push(`${plan.fixFirst.length} need${plan.fixFirst.length === 1 ? "s" : ""} a fix first`);
  const lead = parts.length ? `${parts.join("; ")}.` : "Nothing to resolve.";
  return `${lead} A retest never changes this report: once the causes are fixed, rerun the suite for a report without the gap.`;
}
