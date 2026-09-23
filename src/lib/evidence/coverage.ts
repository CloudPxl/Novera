/**
 * Coverage arithmetic for a run.
 *
 * The single rule this file exists to enforce: a case that errored did not produce a
 * result. It is neither a pass nor a fail, it is excluded from the score, and it is
 * always reported on its own line. A score with no stated basis is meaningless, so
 * `basis` travels with it.
 */
export type CaseStatus = "pass" | "fail" | "error";

export interface CoverageInput {
  plannedCases: number;
  /**
   * `agreement`, `evidenceGap`, `assertionCount`, `failedAssertionCount` and `requiresEvidence`
   * are all optional: rows stored before each distinction existed have none of them,
   * and must keep counting exactly as they always did. Where a number cannot be
   * computed from what a row carries, it comes back `null` — never 0, and never 100.
   */
  cases: Array<{
    status: CaseStatus;
    agreement?: string | null;
    evidenceGap?: string | null;
    /**
     * How many assertions this scenario carries, and how many the judge named as
     * unmet. Counts, deliberately not named `assertions` / `failedAssertions`: a
     * `RunCaseRecord` already uses those names for the `string[]`s themselves, and a
     * record is passed straight into this function in several places. One name for
     * two different facts at a boundary is how information goes missing here.
     */
    assertionCount?: number;
    failedAssertionCount?: number;
    /** Whether the scenario declared an effect, i.e. required evidence beyond words. */
    requiresEvidence?: boolean;
    /** "deterministic" when a rule settled it and no model was asked. */
    settledBy?: string | null;
    /**
     * What an independent read of the customer's own system showed, if one happened.
     *
     * `observationStatus`, not `observation`: a `RunCaseRecord` uses that name for
     * the whole observation object and is passed straight into this function. Sixth
     * time one name has meant two things at a boundary here, and the sixth time the
     * compiler has caught it only because the types happened to differ.
     */
    observationStatus?: string | null;
  }>;
}

export interface Coverage {
  planned: number;
  graded: number;
  passed: number;
  failed: number;
  errored: number;
  /**
   * The subset of `errored` where two models disagreed and a third could not settle it.
   *
   * Deliberately a subset rather than a sibling, so every existing consumer of
   * `errored` keeps its meaning. But it has to be reportable on its own: "the endpoint
   * timed out" and "our judges deadlocked on what this response means" are different
   * facts about the agent, and collapsing them tells a client nothing about which.
   */
  disputed: number;
  /**
   * The subset of `errored` where nothing evidenced an action the response claimed.
   *
   * Also a subset, for the same reason as `disputed`. It says something quite
   * different from both of the others: the agent answered, the models read it, and
   * Novera declined to call it a pass because no evidence exists that the thing it
   * described actually happened. That is a limit of the test setup, not a fault in
   * the agent — and a client reading INCOMPLETE deserves to know which they have.
   */
  unverifiable: number;
  /**
   * How many cases a rule in the scenario settled, with no model asked.
   *
   * Worth reporting rather than hiding: these verdicts are the most defensible ones
   * in the run — true or false about the transcript, quotable, and identical on a
   * rerun. They are also the ones with no corroboration, because nothing about them
   * needed corroborating.
   */
  settledByCheck: number;
  /**
   * Scenarios whose claimed action was checked against the customer's own system.
   *
   * `effectConfirmed` is the only number in this object that says an action actually
   * happened — everything else describes what was said about one. `effectContradicted`
   * is the strongest finding the product can produce: the agent reported doing
   * something and the customer's own system says otherwise.
   */
  effectConfirmed: number;
  effectContradicted: number;
  notRun: number;
  /**
   * How much of the suite produced no verdict, as a share of what was planned.
   *
   * The number a reader actually needs next to an INCOMPLETE grade: not "how did the
   * cases that worked do", but "how much of this evaluation is missing".
   */
  assuranceGap: number;
  /** passed / graded, as a percentage rounded to one decimal. Null when nothing graded. */
  score: number | null;
  basis: string;
  /**
   * Three different questions a single percentage cannot answer.
   *
   * `score` says how the graded cases did. None of these do. They say how much of the
   * evaluation actually happened, which is what a reviewer asks first and what the
   * assurance gap was groping at with one number.
   *
   *  - **execution**: of the scenarios in scope, how many ran at all.
   *  - **resolution**: of the assertions those scenarios carry, how many we can
   *    actually account for. A fail that names no unmet assertion is a verdict
   *    without a reason, and it is counted as unresolved here even though it is
   *    counted as graded above.
   *  - **evidence**: of the scenarios that required proof beyond the agent's words,
   *    how many got it. `null` when none required any — a suite with no effect cases
   *    has not achieved 100% evidence coverage, it simply asked for none.
   */
  executionCoverage: number;
  resolutionCoverage: number | null;
  evidenceCoverage: number | null;
}

export function coverage({ plannedCases, cases }: CoverageInput): Coverage {
  const passed = cases.filter((c) => c.status === "pass").length;
  const failed = cases.filter((c) => c.status === "fail").length;
  const errored = cases.filter((c) => c.status === "error").length;
  const disputed = cases.filter((c) => c.status === "error" && c.agreement === "unresolved").length;
  const unverifiable = cases.filter((c) => c.status === "error" && Boolean(c.evidenceGap)).length;
  const graded = passed + failed;
  const notRun = Math.max(0, plannedCases - (graded + errored));
  const score = graded === 0 ? null : Math.round((passed / graded) * 1000) / 10;
  const assuranceGap =
    plannedCases === 0 ? 0 : Math.round(((errored + notRun) / plannedCases) * 1000) / 10;

  // Assertion-level accounting, and only over rows that carry the counts. A row from
  // before `failed_assertions` existed cannot say whether its assertions were
  // resolved, so it is left out of both sides rather than assumed either way.
  const accountable = cases.filter((c) => typeof c.assertionCount === "number" && c.assertionCount > 0);
  const assertionsTotal = accountable.reduce((n, c) => n + (c.assertionCount ?? 0), 0);
  const assertionsResolved = accountable.reduce((n, c) => {
    if (c.status === "pass") return n + (c.assertionCount ?? 0);
    // A fail naming no unmet assertion is a verdict with no reason attached: we know
    // the case failed and not which requirement it failed. Nothing is resolved.
    if (c.status === "fail" && (c.failedAssertionCount ?? 0) > 0) return n + (c.assertionCount ?? 0);
    return n;
  }, 0);

  const settledByCheck = cases.filter((c) => c.settledBy === "deterministic").length;
  const effectConfirmed = cases.filter((c) => c.observationStatus === "confirmed").length;
  const effectContradicted = cases.filter((c) => c.observationStatus === "contradicted").length;
  const evidenceRequired = cases.filter((c) => c.requiresEvidence).length;
  const evidenceObserved = cases.filter((c) => c.requiresEvidence && !c.evidenceGap).length;

  const percent = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

  return {
    planned: plannedCases,
    graded,
    passed,
    failed,
    errored,
    disputed,
    unverifiable,
    settledByCheck,
    effectConfirmed,
    effectContradicted,
    notRun,
    assuranceGap,
    executionCoverage: plannedCases === 0 ? 0 : percent(graded + errored, plannedCases),
    resolutionCoverage: assertionsTotal === 0 ? null : percent(assertionsResolved, assertionsTotal),
    evidenceCoverage: evidenceRequired === 0 ? null : percent(evidenceObserved, evidenceRequired),
    score,
    basis:
      graded === 0
        ? `No case produced a gradable result, so no score is calculated. ${errored} errored, ${notRun} not run.`
        : `${passed} of ${graded} graded cases passed. ${errored} produced no verdict` +
          (disputed > 0
            ? ` (${disputed} because two models disagreed and a third could not settle it)`
            : "") +
          (unverifiable > 0
            ? ` (${unverifiable} because nothing evidenced an action the agent described)`
            : "") +
          ` and ${notRun} were not run; neither is counted in the score.`,
  };
}

/** Per-obligation coverage. An obligation with nothing graded is reported as not covered. */
export interface ObligationCoverage extends Coverage {
  obligation: string;
  covered: boolean;
}

export function coverageByObligation(
  cases: Array<{ status: CaseStatus; obligation: string }>,
  plannedByObligation: Record<string, number>,
): ObligationCoverage[] {
  const obligations = new Set([
    ...Object.keys(plannedByObligation),
    ...cases.map((c) => c.obligation),
  ]);

  return [...obligations].sort().map((obligation) => {
    const own = cases.filter((c) => c.obligation === obligation);
    const base = coverage({
      plannedCases: plannedByObligation[obligation] ?? own.length,
      cases: own,
    });
    return { ...base, obligation, covered: base.graded > 0 };
  });
}

export interface CategoryCoverage extends Coverage {
  category: string;
  /** True when a case of critical severity failed inside this category. */
  criticalFailure: boolean;
}

/**
 * The same aggregation as `coverageByObligation`, grouped by the suite's own category.
 *
 * Obligations answer "which duty does this evidence speak to"; categories answer
 * "which part of the agent's behaviour was being exercised". A reader wants both, and
 * the suite already carries `category` on every case, so this is arithmetic over data
 * we hold rather than anything new.
 *
 * `criticalFailure` is called out separately because a category can look healthy on
 * percentage alone while the one case that mattered is the one that failed.
 */
export function coverageByCategory(
  cases: Array<{ status: CaseStatus; category: string; severity: string }>,
  plannedByCategory: Record<string, number>,
): CategoryCoverage[] {
  const categories = new Set([
    ...Object.keys(plannedByCategory),
    ...cases.map((c) => c.category),
  ]);

  return [...categories].sort().map((category) => {
    const own = cases.filter((c) => c.category === category);
    const base = coverage({
      plannedCases: plannedByCategory[category] ?? own.length,
      cases: own,
    });
    return {
      ...base,
      category,
      criticalFailure: own.some((c) => c.status === "fail" && c.severity === "critical"),
    };
  });
}
