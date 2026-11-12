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
  /** Set when a retest recorded after the run already reached a verdict: the cause was fixed. */
  fixedBy?: "retest";
}

export interface ResolvePlan {
  retestable: ResolveItem[];
  fixFirst: ResolveItem[];
}

/**
 * What a retest's outcome is called. "Retest failed" read as "the retest broke"; what happened is
 * that the retest worked and the scenario's verdict is a fail. So the two are said apart: a
 * verdict was reached (and which), or the retest again produced no result (and why).
 */
export function retestWords(verdict: CheckVerdict, words: string): string {
  if (verdict === "pass") return "Verdict reached: passed";
  if (verdict === "fail") return "Verdict reached: failed";
  return `No result again: ${words.replace(/^No (verdict|result): /, "")}`;
}

/**
 * The scenarios a completion run may now re-execute: the ones safe to retest, and the fix-first
 * ones a retest has since shown produce a verdict — the fix was made. A retest's verdict is never
 * itself put in a report: a person can retest as often as they like, so sealing a chosen retest
 * would let the tested party pick the sample. The completion run sends the scenario once more,
 * declared before it runs, and seals whatever that one execution produces.
 */
export function completable(plan: ResolvePlan, retests: ReadonlyArray<RetestRow>): ResolveItem[] {
  const reached = new Set(retests.filter((r) => r.status === "pass" || r.status === "fail").map((r) => r.run_case_id));
  return [...plan.retestable, ...plan.fixFirst.filter((item) => item.fixedBy === "retest" || reached.has(item.runCaseId))];
}

export function resolvePlan(cases: ReadonlyArray<{
  runCaseId: string; scenarioId: string; status: string; diagnostic: DiagnosticReport | null;
  /** The newest retest of this scenario reached a pass or a fail. */
  retestReachedVerdict?: boolean;
}>): ResolvePlan {
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
      ...(c.retestReachedVerdict ? { fixedBy: "retest" as const } : {}),
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
      words: retestWords(verdict, words),
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
  return `${lead} A retest never changes this report. To get a report that includes ${transient === 1 ? "this scenario" : "these scenarios"}, complete the evidence below: each is run once more and a new report is sealed, with this one left as it is.`;
}
