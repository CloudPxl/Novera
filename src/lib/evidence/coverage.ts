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
