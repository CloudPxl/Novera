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

/**
 * The grade over the scenarios that did produce a verdict, said with its scope, for a run whose
 * whole-suite grade is withheld.
 *
 * Withholding the letter was right about one thing and wrong about another. Right: a bare "A"
 * over 44 of 49 scenarios claims more than was shown. Wrong: saying nothing left a customer whose
 * agent passed everything that was evaluated with a page reading "not graded", for one scenario
 * their platform could not answer. Both are fixed by never separating the letter from its scope:
 *
 *  - it is always called a scoped grade and always carries "x of y evaluated";
 *  - it always states its floor — the pass rate if every scenario without a verdict had failed —
 *    which is the figure that survives a hostile reading, because it assumes the worst about
 *    everything not shown;
 *  - below `SCOPED_GRADE_MIN_COVERAGE` there is none: under half a suite is not a scope, it is a
 *    different, smaller test;
 *  - the whole-suite band stays INCOMPLETE or WITHHELD, so a release gate, the API's `outcome`
 *    and readiness keep reading missing evidence as missing.
 *
 * Computed from four counts every sealed report already carries, so it can be shown beside a
 * report sealed before this existed without touching what was sealed.
 */
export const SCOPED_GRADE_MIN_COVERAGE = 50;

export interface ScopedGrade {
  band: "A" | "B" | "C" | "F";
  /** passed / evaluated, one decimal. */
  score: number;
  evaluated: number;
  planned: number;
  /** evaluated / planned, one decimal. */
  coveragePercent: number;
  /** Scenarios with no verdict: no result, or not run. */
  missing: number;
  /** passed / planned: the pass rate if every scenario without a verdict had failed. */
  floorScore: number;
  floorBand: "A" | "B" | "C" | "F";
  meetsThreshold: boolean;
  /** Whether the floor itself meets the pass mark: then no outcome of the missing scenarios could have changed that. */
  floorMeetsThreshold: boolean;
  sentence: string;
}

const bandOf = (score: number) => GRADE_BANDS.find((b) => score >= b.min)?.band ?? "F";
const oneDecimal = (part: number, whole: number) => Math.round((part / whole) * 1000) / 10;

export function scopedGrade(args: { passed: number; graded: number; planned: number; threshold: number }): ScopedGrade | null {
  const { passed, graded, planned, threshold } = args;
  if (!(planned > 0) || !(graded > 0) || graded >= planned || passed > graded) return null;
  const coveragePercent = oneDecimal(graded, planned);
  if (coveragePercent < SCOPED_GRADE_MIN_COVERAGE) return null;
  const score = oneDecimal(passed, graded);
  const floorScore = oneDecimal(passed, planned);
  const missing = planned - graded;
  const band = bandOf(score);
  const floorBand = bandOf(floorScore);
  return {
    band, score, evaluated: graded, planned, coveragePercent, missing, floorScore, floorBand,
    meetsThreshold: score >= threshold,
    floorMeetsThreshold: floorScore >= threshold,
    sentence:
      `Scoped grade ${band}: ${passed} of ${graded} evaluated scenarios passed (${score}%), and ${graded} of ${planned} scenarios were evaluated (${coveragePercent}% of the suite). `
      + `${missing} ${missing === 1 ? "scenario has" : "scenarios have"} no verdict and ${missing === 1 ? "is" : "are"} listed with the reason. `
      + `Counting ${missing === 1 ? "it" : "each of them"} as a failure gives ${floorScore}% (${floorBand}).`,
  };
}

/** The scoped grade of a sealed report, from its sealed counts; null when it has a whole-suite grade or too little was evaluated. */
export function scopedGradeOfReport(payload: {
  grade?: { band?: string; threshold?: number } | null;
  coverage?: { passed?: number; failed?: number; planned?: number } | null;
}): ScopedGrade | null {
  const band = payload.grade?.band;
  if (band !== "INCOMPLETE" && band !== "WITHHELD") return null;
  const c = payload.coverage;
  if (!c || typeof c.passed !== "number" || typeof c.failed !== "number" || typeof c.planned !== "number") return null;
  return scopedGrade({ passed: c.passed, graded: c.passed + c.failed, planned: c.planned, threshold: payload.grade?.threshold ?? 80 });
}

export function gradeRun(args: { coverage: Coverage; threshold: number; /** False for a run still in progress: its scope is not yet known. */ scoped?: boolean }): Grade {
  const { coverage, threshold } = args;
  const scoped = args.scoped === false ? null
    : scopedGrade({ passed: coverage.passed, graded: coverage.graded, planned: coverage.planned, threshold });
  // Said in the basis itself, so every surface that prints the basis — exports, the API, a
  // copied summary — carries the scoped figures with their scope.
  const withScope = (basis: string, withheld: string) => (scoped ? `${basis} ${scoped.sentence}` : `${basis} ${withheld}`);

  // Unfinished takes precedence: if scenarios never ran, that is the first thing to
  // say, whatever else also went wrong.
  if (coverage.notRun > 0) {
    return {
      band: "INCOMPLETE",
      score: null,
      threshold,
      basis: (coverage.notSent ?? 0) > 0 && coverage.notSent === coverage.notRun
        ? withScope(
            `${coverage.notRun} of ${coverage.planned} scenarios were not sent to the agent: Novera's own rules held them back ` +
            "(a destructive or test-data scenario against a production agent, or a channel the agent's request template does not have). " +
            "No grade is given for the whole suite, because it would stay silent about the ones that did not run. " +
            "Each one says what to change; fix that and run the suite again.",
            "",
          ).trim()
        : withScope(
            `${coverage.notRun} of ${coverage.planned} scenarios never ran, so ${coverage.graded} produced a verdict. ` +
            "No grade is given for the whole suite, because it would describe " +
            "the scenarios that ran and stay silent about the ones that did not. Run the suite again.",
            "",
          ).trim(),
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
      basis: withScope(
        `Every scenario ran, and ${coverage.graded} of ${coverage.planned} produced a verdict` +
        (reasons.length ? `: ${reasons.join(", ")}` : "") + ".",
        "A grade is withheld rather than calculated over the scenarios that happened to work.",
      ) + (scoped ? " A grade for the whole suite is withheld." : ""),
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
