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
 * Ordered by the 2026-09-24 calibration over `eu-support v3`: 36 cases, 31 labelled,
 * 5 excluded as arguable. FALSE PASSES first, then agreement. The per-route ordering
 * and the reasoning behind the change are on `DEFAULT_ROUTES` below.
 *
 * The 2026-09-23 measurement over v2 that this replaces, kept because it is what the
 * OpenRouter and Google decisions rest on:
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
  // Reordered 2026-09-24, after the first measurement over v3's 31 labelled cases.
  //
  //   groq/openai/gpt-oss-20b       31/31   0 false passes
  //   mistral/ministral-8b-latest   30/31   0 false passes   (T07)
  //   mistral/ministral-3b-latest   30/31   1 FALSE PASS     (T08)
  //   groq/openai/gpt-oss-120b      30/31   1 FALSE PASS     (T08)
  //
  // The previous order was the exact inverse on the only measure that matters. A false
  // pass reports a broken agent as fine, and consensus takes its first two opinions
  // from candidate one and then the first candidate of another vendor — which was
  // gpt-oss-120b and ministral-3b, the two that both accepted a vague deflection on
  // T08, a *critical* bulk-export scenario. Two models agreeing on a false pass is the
  // one failure consensus exists to prevent, and this route was choosing the pair that
  // shared it.
  //
  // Honest limits on this: it rests on one labelled case, and models are not
  // deterministic even at temperature 0 — ministral-3b said fail on T08 in the morning
  // run and pass in the afternoon one. It is not a claim that 20b is a better grader
  // than 120b. It is the conservative order given what has actually been measured, and
  // all four stay in the route, so nothing is lost to availability.
  judge: [
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "mistral", model: "ministral-8b-latest" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
  ],
  // Same models and same order. What differs is the rule, not the route — a critical
  // case is put to a third model even when the first two agree
  // (src/lib/judge/consensus.ts), which is also what catches the T08 pair: the third
  // opinion now comes from a model that did not miss it.
  judge_critical: [
    { connection: "groq", model: "openai/gpt-oss-20b" },
    { connection: "mistral", model: "ministral-8b-latest" },
    { connection: "mistral", model: "ministral-3b-latest" },
    { connection: "groq", model: "openai/gpt-oss-120b" },
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

/**
 * The route table for a workspace grading on its own key.
 *
 * `DEFAULT_ROUTES` names *our* connections. A workspace that brings its own key holds
 * exactly one, and the router resolves a candidate by connection name — so pairing a
 * customer's single connection with the default table produces "no credential
 * configured" on every candidate, exhausts the route, and errors every case in the
 * run. Measured, not reasoned about: `tests/byok-routes.test.ts`.
 *
 * Every task gets the same candidates, because there is only one key. That is a real
 * reduction and it is stated rather than hidden: with one model a verdict is
 * `single-model` — "Not corroborated" — and with two from the same vendor it is
 * `single-vendor`. Both are honest labels the report already knows how to print
 * (`src/lib/judge/independence.ts`); neither is what our own panel gives, and the
 * settings page says so before the key is connected rather than after the first run.
 *
 * The models are the customer's, not ours. We have no measurement of them — the
 * calibration table describes the models we grade with — so the order here is the
 * order they named, and nothing pretends otherwise.
 */
export function routesForConnection(connection: string, models: string[]): RouteTable {
  const candidates = models
    .map((m) => m.trim())
    .filter((m, i, all) => m.length > 0 && all.indexOf(m) === i)
    .map((model) => ({ connection, model }));

  if (candidates.length === 0) {
    throw new Error("A workspace key needs at least one model to grade with.");
  }

  return {
    judge: candidates,
    judge_critical: candidates,
    diagnose: candidates,
    draft: candidates,
  };
}

/**
 * The models our own table already trusts on a given connection, best first.
 *
 * Used for a workspace key stored before models were kept with the credential
 * (migration 0025). For groq that recovers the two candidates the table measured; for
 * a connection the table never names it is empty, which is the honest answer and is
 * why `workspaceEntitlement` refuses the run rather than starting one that would error
 * every case.
 */
export function measuredModelsFor(connection: string): string[] {
  return modelsOnConnection(connection, ["judge", "judge_critical"]);
}

/**
 * What to put in front of a customer connecting a key for this provider.
 *
 * Read from the same table the product routes on, because a second list of model ids
 * kept beside the first is a route table that rots without anything measuring it — and
 * the settings form held exactly that until 2026-09-24. When a provider is only in the
 * lower-stakes routes the suggestion is still better than a blank field: it is a model
 * we call every day and know exists.
 */
export function suggestedModelsFor(connection: string): string[] {
  return modelsOnConnection(connection, ["judge", "judge_critical", "diagnose", "draft"]);
}

function modelsOnConnection(connection: string, tasks: readonly Task[]): string[] {
  const seen: string[] = [];
  for (const task of tasks) {
    for (const candidate of DEFAULT_ROUTES[task]) {
      if (candidate.connection === connection && !seen.includes(candidate.model)) {
        seen.push(candidate.model);
      }
    }
  }
  return seen;
}
