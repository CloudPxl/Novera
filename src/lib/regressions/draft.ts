import { validateSuite } from "../suites/validate.ts";
import type { SuiteCase } from "../runner/types.ts";

/**
 * A production failure, as a regression scenario.
 *
 * No model writes this. The customer's message (redacted) is the input, and what should
 * have happened is the person's own sentence — the expectation a regression test holds
 * the agent to is the one thing that must not be invented. What went wrong, when given,
 * becomes a second assertion, so a reply that repeats the incident fails for the reason
 * it failed in production.
 */

export interface FailureInput {
  customerMessage: string;
  expectedBehavior: string;
  whatWentWrong?: string | null;
  obligation: string;
  severity: string;
}

/** `R01`, `R02`… — ours, never taken from the text. */
export function nextRegressionId(used: Iterable<string>): string {
  let highest = 0;
  for (const id of used) {
    const m = /^R(\d+)$/.exec(id);
    if (m) highest = Math.max(highest, Number(m[1]));
  }
  return `R${String(highest + 1).padStart(2, "0")}`;
}

export function regressionScenario(input: FailureInput, usedIds: Iterable<string>):
  { ok: true; scenario: SuiteCase } | { ok: false; errors: string[] } {
  const expected = input.expectedBehavior.trim();
  const wrong = input.whatWentWrong?.trim();
  const scenario: SuiteCase = {
    id: nextRegressionId(usedIds),
    category: "regression",
    obligation: input.obligation,
    severity: input.severity,
    input: input.customerMessage.trim(),
    expected_behavior: expected,
    assertions: [
      expected,
      ...(wrong ? [`The reply does not repeat what went wrong in production: ${wrong}`] : []),
    ],
  };
  const valid = validateSuite({ key: "regression-check", name: "regression", version: 1, cases: [scenario] });
  return valid.ok ? { ok: true, scenario: valid.suite.cases[0] } : { ok: false, errors: valid.errors };
}

/**
 * Where a failure is in its life, derived from the rows that already record each step —
 * never stored a second time, where it could disagree with them.
 *
 *   drafted → approved (or rejected) → in a suite → run since → held, still failing,
 *   or came back
 *
 * "Came back" is a claim about history: it needs a pass before the failure. A regression
 * that has never passed was never fixed, and saying it came back would be untrue.
 */
export type RegressionStage =
  | { stage: "drafted" }
  | { stage: "rejected"; reason: string | null }
  | { stage: "approved" }
  | { stage: "in_suite"; suite: string }
  | { stage: "held"; suite: string; runAt: string }
  | { stage: "came_back"; suite: string; runAt: string }
  | { stage: "still_failing"; suite: string; runAt: string }
  | { stage: "no_result"; suite: string; runAt: string };

export function regressionStage(args: {
  draftStatus: "draft" | "approved" | "rejected" | "included";
  rejectionReason?: string | null;
  suite?: string | null;
  /** The newest graded result for this case id in a run on that suite, if any. */
  latest?: { status: "pass" | "fail" | "error"; at: string } | null;
  /** Whether any earlier completed run passed it. */
  passedBefore?: boolean;
}): RegressionStage {
  const { draftStatus, suite, latest } = args;
  if (draftStatus === "draft") return { stage: "drafted" };
  if (draftStatus === "rejected") return { stage: "rejected", reason: args.rejectionReason ?? null };
  if (draftStatus === "approved" || !suite) return { stage: "approved" };
  if (!latest) return { stage: "in_suite", suite };
  if (latest.status === "pass") return { stage: "held", suite, runAt: latest.at };
  if (latest.status === "fail") {
    return args.passedBefore ? { stage: "came_back", suite, runAt: latest.at } : { stage: "still_failing", suite, runAt: latest.at };
  }
  // No verdict is not a pass: the defect is neither shown gone nor shown back.
  return { stage: "no_result", suite, runAt: latest.at };
}
