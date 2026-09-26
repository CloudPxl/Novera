import type { ReportPayload } from "./payload.ts";

/**
 * What a sealed report means to a CI pipeline, as a process exit code.
 *
 * A binary pass/fail is the lie this product sells against: a run where half the
 * scenarios never produced a verdict is not a pass, and it is not a regression either.
 * The two need different responses — fix the agent, or fix whatever made the evidence
 * unusable — so they get different codes.
 *
 *   0  every scenario ran and passed, and the report is complete
 *   1  at least one scenario failed
 *   2  the evidence is incomplete: errored, disputed, unverifiable, not run, or no grade
 *   3  configuration or authorisation: no such report, revoked, expired, bad input
 *   4  infrastructure: the report could not be fetched or read
 *
 * A failure outranks missing evidence: a verdict that exists is a finding, whatever
 * else is missing. Codes 3 and 4 are decided by the caller (the CLI), never by a
 * payload — a payload that arrived is, by definition, not a transport problem.
 *
 * Every input is a count sealed in the payload. Nothing is recomputed.
 */
export const CI_EXIT = {
  passed: 0,
  failed: 1,
  incomplete: 2,
  configuration: 3,
  infrastructure: 4,
} as const;

export type CiExitCode = (typeof CI_EXIT)[keyof typeof CI_EXIT];

export interface CiOutcome {
  code: 0 | 1 | 2;
  reason: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function ciOutcome(payload: Pick<ReportPayload, "coverage" | "grade">): CiOutcome {
  const { planned, passed, failed, errored, not_run } = payload.coverage;
  const band = payload.grade?.band;

  if (failed > 0) {
    const missing = errored + not_run;
    return {
      code: CI_EXIT.failed,
      reason: `${plural(failed, "scenario")} failed` + (missing > 0 ? `; ${missing} more produced no verdict` : "") + ".",
    };
  }

  const gaps: string[] = [];
  if (planned === 0) gaps.push("the suite planned no scenarios");
  if (errored > 0) gaps.push(`${plural(errored, "scenario")} produced no result`);
  if (not_run > 0) gaps.push(`${plural(not_run, "scenario")} did not run`);
  // Belt and braces: a band that declined to grade is never a pass, even if the counts
  // above somehow read clean (a format-1 payload has no band at all, and is judged on
  // its counts alone).
  if (band === "WITHHELD") gaps.push("the grade was withheld");
  if (band === "INCOMPLETE") gaps.push("the report is incomplete");
  if (passed + failed + errored + not_run < planned) gaps.push("the counts do not cover every planned scenario");

  if (gaps.length > 0) {
    return { code: CI_EXIT.incomplete, reason: `Evidence incomplete: ${gaps.join("; ")}.` };
  }
  return { code: CI_EXIT.passed, reason: `All ${plural(planned, "scenario")} ran and passed.` };
}
