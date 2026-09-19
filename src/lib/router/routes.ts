/**
 * Which models handle which job, in preference order.
 *
 * Deliberately data, not logic. The relative quality of these models is a question to
 * be measured (scripts/calibrate-judge.mts), not asserted — so changing the order is
 * an edit to this table, backed by a measurement, rather than a code change.
 *
 * Ordering rule: the first candidate is the one we believe is best for the job, not
 * the cheapest. Every candidate here is on a free tier, so cost is not the tie-break;
 * availability is. Later candidates exist so a rate limit does not become an errored
 * case in a customer's report.
 */
export type Task =
  /** Grading an ordinary scenario. */
  | "judge"
  /** Grading a critical or high-severity scenario, where a wrong verdict is expensive. */
  | "judge_critical"
  /** Explaining a failure and proposing a minimal policy change. */
  | "diagnose"
  /** Drafting a support answer or a qualification note for founder review. */
  | "draft";

export interface Candidate {
  connection: string;
  model: string;
}

export type RouteTable = Record<Task, Candidate[]>;

/**
 * Ordered by the 2026-09-19 calibration run (npm run calibrate), 12 labelled cases:
 *
 *   groq/openai/gpt-oss-120b     10/12   0.9s per case   0 false passes
 *   google/gemini-3.5-flash-lite  9/12   0.8s per case   0 false passes
 *   groq/openai/gpt-oss-20b       9/12   0.7s per case   0 false passes
 *   openrouter/nemotron-3-super   9/12   6.4s per case   3 unreadable verdicts
 *   google/gemini-3.5-flash       5/12  11.3s per case   rate-limited on the free tier
 *   openrouter/z-ai/glm-5.2:free  1/12                   upstream errors
 *   google/gemini-pro-latest      0/12                   not on the free tier (quota)
 *
 * Every model caught all six planted failures — no false passes anywhere. The
 * disagreements are all false fails, concentrated on cases where the fixture's
 * generic reply is borderline, so some of them may be our labels being generous
 * rather than the model being wrong.
 *
 * Two models are deliberately absent from every route: gemini-pro-latest (Pro models
 * are not on Google's free tier, so it would always fall through) and glm-5.2:free
 * (returns upstream errors). Re-run the calibration before reordering any of this.
 */
export const DEFAULT_ROUTES: RouteTable = {
  judge: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
  ],
  // Same ordering as `judge`: the measurement gives no reason to prefer a different
  // model for high-stakes cases, since every candidate caught every planted failure.
  // The task stays separate so it can diverge once there is evidence to justify it —
  // the intended next step is consensus grading, where two models must agree.
  judge_critical: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
  ],
  // Not yet measured: diagnosis is a different job from grading (long reasoning, a
  // proposed edit) and the calibration harness does not cover it. Ordered by size as
  // a placeholder, which is a guess and labelled as one.
  diagnose: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
  ],
  // Drafting is latency-sensitive and low-stakes: a human approves every draft.
  draft: [
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
  ],
};

/** High-stakes scenarios get the stronger route; the rest get the fast one. */
export function taskForSeverity(severity: string): Task {
  const s = severity.toLowerCase();
  return s === "critical" || s === "high" ? "judge_critical" : "judge";
}
