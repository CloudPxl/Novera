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

export const DEFAULT_ROUTES: RouteTable = {
  judge: [
    { connection: "google", model: "gemini-3.5-flash" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "openrouter", model: "z-ai/glm-5.2:free" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
  ],
  judge_critical: [
    { connection: "google", model: "gemini-pro-latest" },
    { connection: "openrouter", model: "nvidia/nemotron-3-ultra-550b-a55b:free" },
    { connection: "google", model: "gemini-3.5-flash" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
  ],
  diagnose: [
    { connection: "google", model: "gemini-pro-latest" },
    { connection: "openrouter", model: "nvidia/nemotron-3-super-120b-a12b:free" },
    { connection: "google", model: "gemini-3.5-flash" },
  ],
  draft: [
    { connection: "google", model: "gemini-3.5-flash" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "google", model: "gemini-3.5-flash-lite" },
  ],
};

/** High-stakes scenarios get the stronger route; the rest get the fast one. */
export function taskForSeverity(severity: string): Task {
  const s = severity.toLowerCase();
  return s === "critical" || s === "high" ? "judge_critical" : "judge";
}
