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
  cases: Array<{ status: CaseStatus }>;
}

export interface Coverage {
  planned: number;
  graded: number;
  passed: number;
  failed: number;
  errored: number;
  notRun: number;
  /** passed / graded, as a percentage rounded to one decimal. Null when nothing graded. */
  score: number | null;
  basis: string;
}

export function coverage({ plannedCases, cases }: CoverageInput): Coverage {
  const passed = cases.filter((c) => c.status === "pass").length;
  const failed = cases.filter((c) => c.status === "fail").length;
  const errored = cases.filter((c) => c.status === "error").length;
  const graded = passed + failed;
  const notRun = Math.max(0, plannedCases - (graded + errored));
  const score = graded === 0 ? null : Math.round((passed / graded) * 1000) / 10;

  return {
    planned: plannedCases,
    graded,
    passed,
    failed,
    errored,
    notRun,
    score,
    basis:
      graded === 0
        ? `No case produced a gradable result, so no score is calculated. ${errored} errored, ${notRun} not run.`
        : `${passed} of ${graded} graded cases passed. ${errored} errored and ${notRun} were not run; neither is counted in the score.`,
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
