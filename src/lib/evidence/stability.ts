import type { CaseStatus } from "./coverage.ts";

/**
 * Which scenarios have changed verdict before with nothing changed.
 *
 * The comparison says what a policy edit fixed and what it broke. It says so from two
 * runs — one sample each — against an agent that is a language model and does not
 * answer the same way twice. So a scenario reported "newly broken" can be one of two
 * very different things: the edit broke it, or it breaks some of the time regardless
 * and this was one of those times. Reported the same way, the second sends an operator
 * to revert a change that was fine.
 *
 * TestMu's reports separate "flaky" scenarios from newly failing ones; Braintrust and
 * LangSmith run repeated trials to expose the same thing. We have the evidence already
 * and need no extra runs to use it: every completed run is stored. Two earlier runs of
 * the same suite version against the same agent **under the same policy version** that
 * disagree on a scenario are direct evidence that its verdict moves without a policy
 * change.
 *
 * What this deliberately does not claim is *why*. The agent behind the endpoint belongs
 * to the customer and can change without Novera knowing; the graders are models too.
 * "Its verdict has differed before under this policy version" is the stored fact. It
 * never removes a scenario from "newly broken" — hiding a regression because a scenario
 * has been unstable would be the worse error — it annotates it.
 *
 * Errors are not flips. A case that errored produced no verdict, so it is neither
 * evidence of stability nor of its absence.
 */
export interface HistoricalRun {
  runId: string;
  /** The policy version the run was graded against. The grouping key. */
  policyId: string;
  /**
   * `replySha` is the fingerprint of what the agent said (`run_cases.raw_sha256`, kept
   * after the reply itself expires). Optional: history loaded without it still works,
   * and only says less.
   */
  cases: Array<{ caseId: string; status: CaseStatus; replySha?: string | null }>;
}

export interface CaseStability {
  caseId: string;
  /** The policy version under which the verdict was seen to differ. */
  policyId: string;
  passes: number;
  fails: number;
  /** How many runs under that policy version produced a verdict for this case. */
  runs: number;
  /**
   * What moved, when the fingerprints can say. `graders`: an identical reply was graded
   * both ways — a fact about the grading, never about the agent. `agent`: every reply
   * that was graded differently was different. Absent when a fingerprint is missing.
   */
  cause?: "graders" | "agent";
}

export function unstableCases(history: HistoricalRun[]): Map<string, CaseStability> {
  const byPolicy = new Map<string, HistoricalRun[]>();
  for (const run of history) {
    const list = byPolicy.get(run.policyId) ?? [];
    list.push(run);
    byPolicy.set(run.policyId, list);
  }

  const found = new Map<string, CaseStability>();

  for (const [policyId, runs] of byPolicy) {
    // One run is one sample, and one sample cannot disagree with itself.
    if (runs.length < 2) continue;

    const tally = new Map<string, { passes: number; fails: number; shas: Map<string, Set<string>>; unknownSha: boolean }>();
    for (const run of runs) {
      for (const c of run.cases) {
        if (c.status !== "pass" && c.status !== "fail") continue;
        const t = tally.get(c.caseId) ?? { passes: 0, fails: 0, shas: new Map(), unknownSha: false };
        if (c.status === "pass") t.passes++;
        else t.fails++;
        if (c.replySha) t.shas.set(c.replySha, (t.shas.get(c.replySha) ?? new Set()).add(c.status));
        else t.unknownSha = true;
        tally.set(c.caseId, t);
      }
    }

    for (const [caseId, t] of tally) {
      if (t.passes === 0 || t.fails === 0) continue;
      const gradersMoved = [...t.shas.values()].some((verdicts) => verdicts.size > 1);
      const cause = gradersMoved ? "graders" as const : t.unknownSha ? undefined : "agent" as const;
      const seen = { caseId, policyId, passes: t.passes, fails: t.fails, runs: t.passes + t.fails, ...(cause ? { cause } : {}) };
      // Keep the strongest evidence if a case flipped under more than one version.
      const prior = found.get(caseId);
      if (!prior || seen.runs > prior.runs) found.set(caseId, seen);
    }
  }

  return found;
}

/**
 * The scenarios in a comparison's "fixed" and "newly broken" lists that have moved
 * before without a policy change — the two lists whose meaning depends on the change
 * being the cause.
 */
export function unstableInComparison(
  comparison: { fixed: string[]; newFailures: string[] },
  unstable: Map<string, CaseStability>,
): string[] {
  return [...comparison.fixed, ...comparison.newFailures]
    .filter((id) => unstable.has(id))
    .sort();
}
