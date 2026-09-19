import type { CaseStatus } from "./coverage.ts";

/**
 * Baseline comparison. Nate's rule, kept literally: a rerun has to show what got
 * fixed, what stayed broken, AND what the change broke. Reporting only the first two
 * is how a policy edit quietly makes an agent worse.
 */
export interface ComparableCase {
  caseId: string;
  status: CaseStatus;
}

export interface Comparison {
  fixed: string[];
  persistentFailures: string[];
  newFailures: string[];
  nowErrored: string[];
  errorResolved: string[];
  /** Present in the current run but absent from the baseline — the suite changed. */
  notInBaseline: string[];
  /** In the baseline but missing from the current run — coverage was lost. */
  missingFromCurrent: string[];
  comparable: boolean;
}

export function compareRuns(baseline: ComparableCase[], current: ComparableCase[]): Comparison {
  const before = new Map(baseline.map((c) => [c.caseId, c.status]));
  const after = new Map(current.map((c) => [c.caseId, c.status]));

  const fixed: string[] = [];
  const persistentFailures: string[] = [];
  const newFailures: string[] = [];
  const nowErrored: string[] = [];
  const errorResolved: string[] = [];
  const notInBaseline: string[] = [];

  for (const [caseId, now] of after) {
    const then = before.get(caseId);
    if (then === undefined) {
      notInBaseline.push(caseId);
      continue;
    }
    if (then !== "pass" && now === "pass") fixed.push(caseId);
    if (then === "fail" && now === "fail") persistentFailures.push(caseId);
    if (then === "pass" && now === "fail") newFailures.push(caseId);
    if (then !== "error" && now === "error") nowErrored.push(caseId);
    if (then === "error" && now !== "error") errorResolved.push(caseId);
  }

  const missingFromCurrent = [...before.keys()].filter((id) => !after.has(id));

  return {
    fixed: fixed.sort(),
    persistentFailures: persistentFailures.sort(),
    newFailures: newFailures.sort(),
    nowErrored: nowErrored.sort(),
    errorResolved: errorResolved.sort(),
    notInBaseline: notInBaseline.sort(),
    missingFromCurrent: missingFromCurrent.sort(),
    // Two runs over different case sets can still be shown, but the diff is partial
    // and the report has to say so.
    comparable: notInBaseline.length === 0 && missingFromCurrent.length === 0,
  };
}
