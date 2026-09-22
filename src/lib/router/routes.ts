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
 * Ordered by the 2026-09-22 calibration run (npm run calibrate), 11 labelled cases,
 * 5 excluded as arguable. FALSE PASSES first, then agreement, then latency:
 *
 *   groq/openai/gpt-oss-120b     11/11   0.8s per case   0 false passes
 *   groq/openai/gpt-oss-20b      10/11   0.8s per case   0 false passes
 *   mistral/ministral-3b-latest  10/11   2.1s per case   0 false passes
 *   mistral/ministral-8b-latest   9/11   2.5s per case   0 false passes
 *   mistral/ministral-14b-latest  9/11   2.7s per case   0 false passes
 *   openrouter/nemotron-3-super   9/11   7.0s per case   2 unreadable verdicts
 *   google/gemini-3.5-flash-lite  8/11  11.4s per case   MISSED T11
 *   google/gemini-3.5-flash       0/11   4.8s per case   no readable verdict, 11/11
 *
 * Two things changed from the 2026-09-19 table, and both were found by re-measuring
 * rather than by anything going visibly wrong:
 *
 * **Google is out of both grading routes.** `gemini-3.5-flash-lite` was the second
 * candidate — the usual corroborating vote — and it now misses a planted failure
 * (T11), reproducibly, across two separate runs. A model with false passes is
 * unusable here: a false fail is annoying, a false pass is the one failure mode a
 * customer cannot detect. It stays on `diagnose` and `draft`, where a human approves
 * the output before it counts as anything. `gemini-3.5-flash` returned no readable
 * verdict on every case. Nothing was edited to cause this; the models moved under a
 * fixed name, which is the reason this table is re-measured rather than maintained.
 *
 * **Mistral is in, and it is placed second on purpose.** It is not the second most
 * accurate candidate by a hair — `gpt-oss-20b` ties it — but it is the first
 * candidate from a *different vendor*, and consensus asks the second opinion of a
 * different vendor before a different model. Two gpt-oss votes agreeing is close to
 * one vote counted twice. Ordering the table so the natural fallback also crosses
 * vendors means the degraded path stays independent too.
 *
 * Both connections were verified funded on 2026-09-22 (`npm run verify:models`).
 * OpenAI authenticates but has no credits, so it is deliberately in no route: an
 * unfunded connection would burn a failed attempt on every single call.
 */
export const DEFAULT_ROUTES: RouteTable = {
  judge: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "mistral", model: "ministral-8b-latest" },
  ],
  // Same models as `judge`, same measurement: every candidate here caught every
  // planted failure. The task stays separate because it is where a stricter policy
  // would land first — three votes rather than two, say — once there is evidence for
  // one.
  judge_critical: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "mistral", model: "ministral-8b-latest" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
  ],
  // Not measured by the calibration harness: diagnosis is a different job from
  // grading (long reasoning, a proposed edit) and has no labelled ground truth.
  // Ordered by size as a placeholder, which is a guess and labelled as one. Google
  // is allowed here because a diagnosis is a proposal a human approves, never an
  // edit, so a weak one costs a click rather than a wrong verdict in a report.
  diagnose: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "mistral", model: "ministral-14b-latest" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
  ],
  // Drafting is latency-sensitive and low-stakes: a human approves every draft.
  draft: [
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
  ],
};

/** High-stakes scenarios get the stronger route; the rest get the fast one. */
export function taskForSeverity(severity: string): Task {
  const s = severity.toLowerCase();
  return s === "critical" || s === "high" ? "judge_critical" : "judge";
}
