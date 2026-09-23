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
 * Ordered by the 2026-09-23 calibration (npm run calibrate) over `eu-support v2`:
 * 24 cases, 19 labelled, 5 excluded as arguable. FALSE PASSES first, then agreement:
 *
 *   groq/openai/gpt-oss-120b     19/19   0 false passes   0 unreadable
 *   mistral/ministral-3b-latest  18/19   0 false passes   0 unreadable
 *   mistral/ministral-8b-latest  17/19   0 false passes   0 unreadable
 *   groq/openai/gpt-oss-20b      17/19   0 false passes   1 unreadable
 *   openrouter/nemotron-3-super  12/19   MISSED T21       6 unreadable
 *
 * **OpenRouter is out of both grading routes**, for two independent reasons.
 *
 * It false-passed T21 — an agent claiming it had actioned an unsubscribe with no tool
 * activity behind it, which is the exact failure this product exists to catch. The
 * standing rule is that a model with false passes is unusable here: a false fail is
 * annoying, a false pass is the one a customer cannot detect. That alone settles it.
 *
 * The second reason is structural and worth writing down, because it rules out the
 * obvious fix. OpenRouter's `:free` models are served from a **shared upstream pool**
 * and answer `temporarily rate-limited upstream` as a class, not per model — three
 * separate candidates returned it on every case within seconds. There is no free
 * OpenRouter model to promote in nemotron's place. It stays on `diagnose` and
 * `draft`, where a person approves the output before it counts as anything.
 *
 * That leaves **two dependable grading vendors**, groq and mistral, both measured with
 * no false passes. Consensus still crosses vendors for the second opinion, which is
 * the one that matters most; a third opinion on a critical scenario will sometimes
 * have to come from a model of the same vendor, and the report says so when it does.
 * Adding a genuine third vendor — a funded OpenAI key is the cheapest route — would
 * restore it, and is the reason that key is kept rather than deleted.
 *
 * Google was removed on 2026-09-22 for a reproducible false pass of its own.
 *
 * Two facts about the free tiers, both found by measuring rather than reading docs:
 * Groq limits **tokens** per minute (~8k), not requests, so a judge prompt is ~1,500
 * of them; Mistral limits requests (~1/s). `npm run calibrate` paces for both.
 */
export const DEFAULT_ROUTES: RouteTable = {
  judge: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "mistral", model: "ministral-8b-latest" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
  ],
  // Same models and same order: every candidate here has zero measured false passes,
  // and there is no evidence for preferring a different one on a critical scenario.
  // What differs is the rule, not the route — a critical case is put to a third model
  // even when the first two agree (src/lib/judge/consensus.ts).
  judge_critical: [
    { connection: "groq", model: "openai/gpt-oss-120b" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "mistral", model: "ministral-8b-latest" },
    { connection: "groq", model: "openai/gpt-oss-20b" },
  ],
  // Not measured by the calibration harness: diagnosis is a different job from grading
  // (long reasoning, a proposed edit) and has no labelled ground truth. Ordered by
  // size, which is a guess and labelled as one. Google and OpenRouter are allowed here
  // because a diagnosis is a proposal a human approves, never an edit, so a weak one
  // costs a click rather than a wrong verdict in a client's report.
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
