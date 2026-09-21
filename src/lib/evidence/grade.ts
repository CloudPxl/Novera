import type { Coverage } from "./coverage.ts";

/**
 * Turning a score into a letter, and refusing to when that would mislead.
 *
 * A letter grade compresses a page of evidence into one character, which is precisely
 * the move this product exists to argue against. It is worth having anyway — a
 * delivery lead needs something to say in a meeting — but only under a rule that stops
 * it papering over the thing a reader most needs to know.
 *
 * That rule: **a run that did not fully execute gets no letter.** If any case errored,
 * went unresolved between models, or never ran, the grade is `INCOMPLETE`. A "B" over
 * four ungraded scenarios is a more confident claim than the evidence supports, and it
 * is the exact failure the coverage basis line was written to prevent.
 */
export type GradeBand = "A" | "B" | "C" | "F" | "INCOMPLETE";

export interface Grade {
  band: GradeBand;
  /** Null when the run did not fully execute; there is no percentage worth printing. */
  score: number | null;
  /** The bar this was measured against, so the band can be checked. */
  threshold: number;
  /** Always shown next to the band. States what it rests on, or why there isn't one. */
  basis: string;
}

export const GRADE_BANDS = [
  { band: "A" as const, min: 90 },
  { band: "B" as const, min: 80 },
  { band: "C" as const, min: 70 },
];

export function gradeRun(args: { coverage: Coverage; threshold: number }): Grade {
  const { coverage, threshold } = args;
  const incomplete = coverage.errored > 0 || coverage.notRun > 0 || coverage.score === null;

  if (incomplete) {
    return {
      band: "INCOMPLETE",
      score: null,
      threshold,
      basis:
        `${coverage.graded} of ${coverage.planned} scenarios produced a verdict. ` +
        "A grade is not shown for a run that did not fully execute, because it would " +
        "describe the scenarios that worked and stay silent about the ones that did not.",
    };
  }

  const score = coverage.score as number;
  const band = GRADE_BANDS.find((b) => score >= b.min)?.band ?? "F";

  return {
    band,
    score,
    threshold,
    basis:
      `${coverage.passed} of ${coverage.graded} scenarios passed. ` +
      `Graded against a pass mark of ${threshold}%.`,
  };
}

/** Whether the run met the bar the customer set. Separate from the letter on purpose. */
export function meetsThreshold(grade: Grade): boolean | null {
  return grade.score === null ? null : grade.score >= grade.threshold;
}
