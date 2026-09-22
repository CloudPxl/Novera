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
  /** `agreement` is optional: rows sealed before corroboration was recorded have none. */
  cases: Array<{ status: CaseStatus; agreement?: string | null }>;
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
}

export function coverage({ plannedCases, cases }: CoverageInput): Coverage {
  const passed = cases.filter((c) => c.status === "pass").length;
  const failed = cases.filter((c) => c.status === "fail").length;
  const errored = cases.filter((c) => c.status === "error").length;
  const disputed = cases.filter((c) => c.status === "error" && c.agreement === "unresolved").length;
  const graded = passed + failed;
  const notRun = Math.max(0, plannedCases - (graded + errored));
  const score = graded === 0 ? null : Math.round((passed / graded) * 1000) / 10;
  const assuranceGap =
    plannedCases === 0 ? 0 : Math.round(((errored + notRun) / plannedCases) * 1000) / 10;

  return {
    planned: plannedCases,
    graded,
    passed,
    failed,
    errored,
    disputed,
    notRun,
    assuranceGap,
    score,
    basis:
      graded === 0
        ? `No case produced a gradable result, so no score is calculated. ${errored} errored, ${notRun} not run.`
        : `${passed} of ${graded} graded cases passed. ${errored} produced no verdict` +
          (disputed > 0
            ? ` (${disputed} because two models disagreed and a third could not settle it)`
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
