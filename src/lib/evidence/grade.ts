import type { Coverage } from "./coverage.ts";

/**
 * Turning a score into a letter, and refusing to when that would mislead.
 *
 * A letter grade compresses a page of evidence into one character, which is precisely
 * the move this product exists to argue against. It is worth having anyway — a
 * delivery lead needs something to say in a meeting — but only under a rule that stops
 * it papering over the thing a reader most needs to know.
 *
 * That rule: **a run that did not fully execute gets no letter.** A "B" over four
 * ungraded scenarios is a more confident claim than the evidence supports, and it is
 * the exact failure the coverage basis line was written to prevent.
 *
 * Withholding has two reasons, and they are not the same fact:
 *
 *  - `INCOMPLETE` — the run did not finish. Some scenarios never ran at all. The
 *    remedy is to run it again.
 *  - `WITHHELD` — the run finished and the evidence still does not support a grade:
 *    a scenario errored, two models deadlocked, or an action could not be verified.
 *    Running it again changes nothing on its own; something has to be fixed or
 *    configured first.
 *
 * Both withhold the letter. Telling a customer to rerun when the endpoint is dead, or
 * to fix their agent when the run was simply cut short, is the difference between the
 * two, and a single `INCOMPLETE` said neither.
 */
export type GradeBand = "A" | "B" | "C" | "F" | "INCOMPLETE" | "WITHHELD";

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

  // Unfinished takes precedence: if scenarios never ran, that is the first thing to
  // say, whatever else also went wrong.
  if (coverage.notRun > 0) {
    return {
      band: "INCOMPLETE",
      score: null,
      threshold,
      basis:
        `${coverage.notRun} of ${coverage.planned} scenarios never ran, so ${coverage.graded} produced a verdict. ` +
        "A grade is not shown for a run that did not finish, because it would describe " +
        "the scenarios that ran and stay silent about the ones that did not. Run the suite again.",
    };
  }

  if (coverage.errored > 0 || coverage.score === null) {
    const reasons = [
      coverage.unverifiable > 0
        ? `${coverage.unverifiable} could not be verified because nothing evidenced an action the agent described`
        : null,
      coverage.disputed > 0
        ? `${coverage.disputed} could not be settled between models`
        : null,
      coverage.errored - coverage.unverifiable - coverage.disputed > 0
        ? `${coverage.errored - coverage.unverifiable - coverage.disputed} produced no result at all`
        : null,
    ].filter(Boolean);

    return {
      band: "WITHHELD",
      score: null,
      threshold,
      basis:
        `Every scenario ran, and ${coverage.graded} of ${coverage.planned} produced a verdict` +
        (reasons.length ? `: ${reasons.join(", ")}` : "") +
        ". A grade is withheld rather than calculated over the scenarios that happened to work.",
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
