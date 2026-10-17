import { LOCALES, isLocale, type Locale } from "../suites/locale-names.ts";

/**
 * A single-scenario check, the parts without a database: what a request asks for, what a
 * verdict is called, how the rolling-hour limit answers, and what a caller is shown.
 *
 * Browser-safe on purpose — no suite files, no hashing, no Supabase — so the button that runs a
 * check can name it with the same words the API answers with.
 *
 * A check is one scenario sent to one agent and graded by `executeCase`, exactly as a run grades
 * it. It is not a run: it is stored in `case_retests`, never reaches a score, a coverage figure,
 * a baseline, a report or the trial's run count, and every surface that shows one says so in the
 * words below.
 */

/** Shown above every check's result, and returned with every API answer. Exactly this. */
export const CHECK_LABEL = "Single-scenario check — not a sealed run.";

/** 20 checks per workspace in any rolling hour (0072 `take_scenario_check_slot`). */
export const CHECK_LIMIT = { max: 20, windowSeconds: 60 * 60 } as const;

/** The most `POST /api/v1/probes/single` reads of a request: its body is four short fields. */
export const CHECK_BODY_LIMIT = 16 * 1024;
export const CHECK_BODY_TOO_LARGE = `The request body is larger than ${CHECK_BODY_LIMIT / 1024} KB, so it was not read. Send only agent_id, suite, scenario_id and locale.`;

/** A scenario id as suites hold them (`T07`, `GDPR-12`, `kyc.03`). */
const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** A suite key as the suites table holds them, optionally with `-v<version>` (as the CI trigger reads it). */
const SUITE_REF = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export interface SingleCheckRequest {
  agentId: string;
  /** Exactly one of these. */
  suiteId: string | null;
  suiteRef: string | null;
  scenarioId: string;
  locale: Locale;
}

type Body = Record<string, unknown>;

/** The first of several spellings that is present: the API's snake_case, then camelCase. */
function field(body: Body, ...names: string[]): unknown {
  for (const n of names) if (body[n] !== undefined && body[n] !== null && body[n] !== "") return body[n];
  return undefined;
}

/**
 * `POST /api/v1/probes/single`'s body: `{ agent_id, suite | suite_id, scenario_id, locale? }`,
 * camelCase accepted too (`agentId`, `suiteSlug`, `suiteId`, `scenarioId`). Strict about values;
 * unknown fields are ignored, as on every other `/api/v1` write.
 */
export function parseSingleCheckBody(raw: unknown): SingleCheckRequest | { error: string } {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { error: "Send a JSON object: { \"agent_id\": \"…\", \"suite\": \"eu-support-v5\", \"scenario_id\": \"T07\" }." };
  }
  const body = raw as Body;

  const agentId = field(body, "agent_id", "agentId");
  if (typeof agentId !== "string" || !UUID.test(agentId)) {
    return { error: "`agent_id` must be an agent id. GET /api/v1/agents lists them." };
  }

  const suiteId = field(body, "suite_id", "suiteId");
  const suiteRef = field(body, "suite", "suite_key", "suiteKey", "suite_slug", "suiteSlug");
  if (suiteId === undefined && suiteRef === undefined) {
    return { error: "Name the suite: `suite` as a key such as `eu-support-v5`, or `suite_id`. GET /api/v1/suites lists them." };
  }
  if (suiteId !== undefined && suiteRef !== undefined) {
    return { error: "Name the suite once: `suite_id`, or `suite` as a key such as `eu-support-v5`." };
  }
  if (suiteId !== undefined && (typeof suiteId !== "string" || !UUID.test(suiteId))) {
    return { error: "`suite_id` must be a suite id. GET /api/v1/suites lists them." };
  }
  if (suiteRef !== undefined && (typeof suiteRef !== "string" || !SUITE_REF.test(suiteRef.trim().toLowerCase()))) {
    return { error: "`suite` must be a suite key such as `eu-support` or `eu-support-v5`. GET /api/v1/suites lists them." };
  }

  const scenarioId = field(body, "scenario_id", "scenarioId", "case_id", "caseId");
  if (typeof scenarioId !== "string" || !SCENARIO_ID.test(scenarioId.trim())) {
    return { error: "`scenario_id` must be a scenario id from the suite, such as `T07`." };
  }

  const locale = field(body, "locale", "language");
  if (locale !== undefined && !isLocale(locale)) {
    return { error: `\`locale\` must be one of ${LOCALES.join(", ")}.` };
  }

  return {
    agentId: agentId.toLowerCase(),
    suiteId: typeof suiteId === "string" ? suiteId.toLowerCase() : null,
    suiteRef: typeof suiteRef === "string" ? suiteRef.trim().toLowerCase() : null,
    scenarioId: scenarioId.trim(),
    locale: (locale as Locale | undefined) ?? "en",
  };
}

/**
 * What a check found, in the API's words. `error` is a scenario that could not be run or could
 * not be read (the agent did not answer, a guard refused it); `no_verdict` is one that ran and
 * whose evidence does not support a verdict — two models deadlocked and a third could not settle
 * it, or the action it claimed could not be evidenced. Neither is ever a pass.
 */
export type CheckVerdict = "pass" | "fail" | "error" | "no_verdict";
export type NoVerdictReason = "disputed" | "no_tool_evidence" | "no_state_evidence" | "read_back_unavailable";

export function checkVerdict(row: { status: string; judge_agreement?: string | null; evidence_gap?: string | null }): {
  verdict: CheckVerdict; noVerdictReason: NoVerdictReason | null;
} {
  if (row.status === "pass") return { verdict: "pass", noVerdictReason: null };
  if (row.status === "fail") return { verdict: "fail", noVerdictReason: null };
  if (row.evidence_gap === "no_tool_evidence" || row.evidence_gap === "no_state_evidence" || row.evidence_gap === "read_back_unavailable") {
    return { verdict: "no_verdict", noVerdictReason: row.evidence_gap };
  }
  if (row.judge_agreement === "unresolved") return { verdict: "no_verdict", noVerdictReason: "disputed" };
  return { verdict: "error", noVerdictReason: null };
}

/** The words a person reads for each verdict: never "passed" for anything but a pass. */
export function verdictWords(verdict: CheckVerdict, reason: NoVerdictReason | null): string {
  switch (verdict) {
    case "pass": return "Passed";
    case "fail": return "Failed";
    case "no_verdict":
      return reason === "disputed"
        ? "No verdict: the models disagreed and a third could not settle it"
        : reason === "read_back_unavailable"
          ? "No verdict: the read-back of your system was unavailable"
          : "No verdict: the action it claimed was not evidenced";
    case "error": return "No result: the scenario could not be run or read";
  }
}

/** The answer of 0072's `take_scenario_check_slot`, read defensively. Null when it is not one. */
export interface SlotDecision {
  allowed: boolean;
  remaining: number;
  resetsAt: string;
}

export function readSlot(data: unknown): SlotDecision | null {
  if (!data || typeof data !== "object") return null;
  const d = data as Record<string, unknown>;
  const resets = typeof d.resets_at === "string" ? Date.parse(d.resets_at) : NaN;
  if (typeof d.allowed !== "boolean" || typeof d.remaining !== "number" || !Number.isFinite(resets)) return null;
  return { allowed: d.allowed, remaining: Math.max(0, Math.floor(d.remaining)), resetsAt: new Date(resets).toISOString() };
}

/**
 * The rolling window, as the database decides it, for a test and for a sentence: the slots
 * taken in the last `windowSeconds`, whether one more fits, and when the oldest one leaves.
 * `take_scenario_check_slot` is the same arithmetic under a lock.
 */
export function rollingWindow(takenAt: readonly number[], now: number, limit: { max: number; windowSeconds: number } = CHECK_LIMIT): SlotDecision {
  const windowMs = limit.windowSeconds * 1000;
  const inWindow = takenAt.filter((t) => t > now - windowMs).sort((a, b) => a - b);
  const oldest = inWindow[0] ?? now;
  if (inWindow.length >= limit.max) {
    return { allowed: false, remaining: 0, resetsAt: new Date(oldest + windowMs).toISOString() };
  }
  return { allowed: true, remaining: limit.max - inWindow.length - 1, resetsAt: new Date(oldest + windowMs).toISOString() };
}

/** Whole seconds until `resetsAt`, never less than one: "try again in 0" is not a next step. */
export function secondsUntil(resetsAt: string, now = Date.now()): number {
  return Math.max(1, Math.ceil((Date.parse(resetsAt) - now) / 1000));
}

/** What a refused caller is told: how many, and when the next one may start. */
export function limitRefusal(resetsAt: string, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil(secondsUntil(resetsAt, now) / 60));
  const at = new Date(resetsAt).toISOString().slice(11, 16);
  return `This workspace has run ${CHECK_LIMIT.max} single-scenario checks in the last hour. `
    + `The next one can start at ${at} UTC, in ${minutes === 1 ? "about a minute" : `about ${minutes} minutes`}. `
    + "A full run of the suite is not affected by this limit.";
}

/** When the count could not be read: a check spends model calls, so it is not sent uncounted. */
export const LIMIT_UNAVAILABLE =
  "Novera could not count this workspace's single-scenario checks just now, so this one was not sent. Try again in a minute.";
