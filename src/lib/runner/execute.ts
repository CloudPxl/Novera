import type { AgentAdapter, AgentResult } from "../agents/types.ts";
import { extractJsonObject } from "../judge/parse.ts";
import { SIMULATOR_SYSTEM, parseSimulatorReply, simulatorPrompt, type Persona } from "../simulate/persona.ts";
import { withDeadline, type RoutedChat } from "../router/execute.ts";
import { AGENT_TIMEOUT_MAX_MS } from "../agents/http.ts";
import { gradeCase, type PendingGrading } from "../judge/consensus.ts";
import { applyEffectRule } from "../judge/effect.ts";
import { runChecks, describeFailures } from "../judge/checks.ts";
import type { VerificationConnector, VerificationObservation } from "../evidence/connectors/types.ts";
import { coverage, coverageByObligation, coverageByCategory, type Coverage, type ObligationCoverage, type CategoryCoverage } from "../evidence/coverage.ts";
import type { CaseOutcome, ConversationTurn, HeldCase, RunCaseRecord, RunStore, Suite, SuiteCase } from "./types.ts";
import { conversationInput, conversationResponse, mergeToolActivity } from "./conversation.ts";
import { quotedReason } from "../agents/upstream-error.ts";

export interface ExecuteRunArgs {
  runId: string;
  suite: Suite;
  agent: AgentAdapter;
  /** Reads the customer's own system to confirm a claimed action. Usually null. */
  verifier?: VerificationConnector | null;
  agentIsProduction?: boolean;
  /** The approved policy text for this run; a run always names its policy version. */
  policy: string;
  /** Routed chat: the severity of each case decides which route grades it. */
  judge: RoutedChat;
  store: RunStore;
  /** Kept low by default: customer endpoints and free judge tiers both rate-limit. */
  concurrency?: number;
  /** Case ids already recorded by an earlier attempt. Never graded twice. */
  skipCaseIds?: string[];
  /**
   * Cases an earlier slice held because their grading stopped for capacity (0084): never sent
   * again, their grading resumed once due.
   */
  held?: HeldCase[];
  /** How long a held case waits before it is graded again. `HOLD_GAP_MS` unless a test says otherwise. */
  holdGapMs?: number;
  /**
   * Stop picking up new cases after this moment.
   *
   * Serverless functions are killed at a fixed ceiling with no warning and no chance
   * to record anything. Stopping ourselves a little early turns that into an ordinary
   * `incomplete` result the caller can resume, instead of a run stuck at "running"
   * with half its evidence and no explanation.
   */
  deadline?: number;
  /**
   * The minimum gap, in ms, between successive sends to the agent across every worker of
   * this slice. Default 0 (no pacing). A customer's endpoint is not ours to hammer.
   */
  paceMs?: number;
  /** Send one scenario at a time: the connection says its platform needs it. */
  oneAtATime?: boolean;
  /** Start slow, one at a time with a gap: an earlier slice of this run met a platform limit. */
  startSlow?: boolean;
  /**
   * Send the adapter's harmless check message before the first scenario of a run that has
   * recorded nothing yet, and end the run before any scenario when it gets no usable reply.
   */
  probeFirst?: boolean;
  /** Test seams: the waits before a throttled message is sent again, and the first slow gap. */
  throttleWaitsMs?: readonly number[];
  slowGapStartMs?: number;
}

/** Production pacing between sends to a customer's agent (ms). */
export const AGENT_PACE_MS = 250;
/** The longest gap a connection may ask for between two sends (ms). */
export const MAX_AGENT_PACE_MS = 10_000;

/** Consecutive transport failures that end a run. */
export const TRANSPORT_HALT_AFTER = 3;

export const TRANSPORT_HALT_MESSAGE =
  "Target endpoint unreachable or rate-limited; run halted. Three scenarios in a row could not reach the agent "
  + "(HTTP 429/5xx or no connection). They are recorded as errors, never as failures of the agent; the remaining "
  + "scenarios were not sent, and no report is sealed.";

const TRANSPORT_STATUS = new Set([408, 429, 502, 503, 504]);

/**
 * The run's end when its agent's address answers with a redirect. Novera never follows one (a
 * redirect could carry the scenario, and a credential, to an address the public-address check
 * never saw), so every scenario would be the same configuration error: three in a row end the
 * run the way an unreachable endpoint does, and a CI gate reads it as configuration (exit 3).
 */
export const REDIRECT_HALT_MESSAGE =
  "The agent's address answers with a redirect; run halted. Three scenarios in a row were answered with "
  + "HTTP 3xx, and Novera does not follow redirects, so a request never reaches an address it did not check. "
  + "Change the agent's endpoint to the final address (each scenario's error names where the redirect points). "
  + "They are recorded as errors, never as failures of the agent; the remaining scenarios were not sent, and no report is sealed.";

const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);

/** Whether an agent result is a redirect the request was not allowed to follow. */
export function isRedirectAnswer(result: Partial<AgentResult> & { ok: boolean }): boolean {
  return !result.ok && result.statusCode !== undefined && REDIRECT_STATUS.has(result.statusCode);
}

/**
 * Whether an agent result is a transport failure: the request did not get a usable answer
 * from the agent's server (408/429/502/503/504, or no HTTP status at all — refused, reset,
 * DNS, timeout). Not transport: Novera's own refusals ("Not sent"), a wait cut by Novera's
 * time slice, and anything the agent did answer (other statuses, invalid JSON, wrong path).
 */
export function isTransportFailure(result: Partial<AgentResult> & { ok: boolean }): boolean {
  if (result.ok || result.cutByNovera) return false;
  // A limit stated in a 2xx body or inside a stream is the endpoint's availability too.
  if (result.failure?.kind === "throttled") return true;
  if (result.statusCode !== undefined) return TRANSPORT_STATUS.has(result.statusCode);
  return !(result.error ?? "").startsWith("Not sent");
}

/**
 * One more attempt, for a request the agent's server failed: how long after the first, and when
 * it is made at all.
 *
 * A single HTTP 500 is a common no-result, and many are gone a second later. So a message that
 * got one is sent once more — only a message that cannot
 * act on anything twice (the scenario declares no effect and is not destructive), never after a
 * timeout (the wait would be doubled, and the first request may still be running), and never
 * when the slice has no room for it. What the second attempt answers is the result. If it fails
 * the same way, the error says both attempts did, because "twice, 1.5 s apart, while other
 * scenarios were answered" is a different fact from "once".
 *
 * It is still not a verdict. An endpoint that answers 5xx or 4xx to one scenario has produced
 * no reply to grade: something in front of the agent may have rejected the input, or the agent
 * may have failed on it, and from outside those look the same (in the run that prompted this, a
 * relay turned a firewall's block page into HTTP 500). Calling the first a pass and the second a
 * fail would be a guess about which it was.
 */
export const AGENT_RETRY_AFTER_MS = 1_500;

export function worthOneMoreAttempt(result: Partial<AgentResult> & { ok: boolean }, testCase: Pick<SuiteCase, "effect" | "destructive">): boolean {
  if (result.ok || result.cutByNovera || result.timedOut) return false;
  if (testCase.effect || testCase.destructive) return false;
  // A workflow, or one of its steps, that failed part-way on the platform: the same kind of
  // failure, reported inside an answer instead of as a status.
  // Otherwise only where the agent's own server answered that it failed. An unreachable or rate-limiting
  // endpoint (`isTransportFailure`) is not asked again: three of those in a row end the run, and
  // a second request to an endpoint that is refusing them is the opposite of pacing.
  if (result.failure?.transient && !isTransportFailure(result)) return true;
  return result.statusCode !== undefined && result.statusCode >= 500 && result.statusCode <= 599 && !isTransportFailure(result);
}

/**
 * A platform that says it is over a limit is asked again after a wait: 2 s, then 5 s, or what its
 * Retry-After asks (at most 20 s), while the slice has room. A 429 refused the request at the door,
 * so it is sent again for any scenario and any turn. A limit stated inside an answer (a stream that
 * ended "too many requests") may come after the platform ran part of its work, so it is sent again
 * only for the first message of a scenario that cannot act twice.
 */
export const THROTTLE_WAITS_MS = [2_000, 5_000] as const;

export function mayResendThrottled(result: AgentResult, testCase: Pick<SuiteCase, "effect" | "destructive">, turnNumber: number): boolean {
  if (result.ok || result.failure?.kind !== "throttled") return false;
  if (result.failure.refusedAtDoor) return true;
  return turnNumber === 1 && !testCase.effect && !testCase.destructive;
}

/**
 * After the first limit, the slice sends one scenario at a time with a gap that starts here and
 * doubles with each further limit, up to the ceiling.
 */
export const SLOW_GAP_START_MS = 2_000;
export const SLOW_GAP_MAX_MS = 8_000;

/**
 * The run's end when one cause repeats: three scenarios in a row failing the same way, and the
 * harmless check message sent right after failing too. Whatever the scenarios were, the
 * connection answers nothing usable, and sending the rest would record the same error for each.
 * When the check message *is* answered, the cause is in those scenarios (a filter that refuses
 * attack-shaped input, a branch of the agent's flow that ends without an answer) and the run
 * continues. Also the run's end when that check, sent before the first scenario, gets no usable
 * reply. A CI gate reads it as configuration (exit 3).
 */
export const CONNECTION_HALT_PREFIX = "Connection check failed; run halted.";

/** The failures that count towards one repeating cause. Limits, transport and redirects have their own halts. */
const BREAKER_KINDS = new Set(["refused_auth", "refused_input", "platform_error", "web_page", "unreadable", "path_miss", "repeated_stream", "empty", "too_large", "timeout"]);

function haltAfterRepeat(caseError: string, probeError: string | undefined, same: boolean): string {
  return `${CONNECTION_HALT_PREFIX} Three scenarios in a row failed the same way, and the check message Novera sent right after `
    + `${same ? "failed the same way" : "got no usable reply either"}, so the cause is the agent's connection, not the scenarios. `
    + `The last scenario recorded: ${caseError}${!same && probeError ? ` The check message got: ${probeError}` : ""} `
    + "They are recorded as errors, never as failures of the agent; the remaining scenarios were not sent, and no report is sealed. "
    + "Fix the connection (the agent's page tests it with one message), then start the run again.";
}

export function haltBeforeFirst(probeError: string): string {
  return `${CONNECTION_HALT_PREFIX} Before the first scenario, Novera sent its harmless check message, and it got no usable reply: ${probeError} `
    + "No scenario was sent, nothing was recorded, and no run allowance was spent. "
    + "Fix the connection (the agent's page tests it with one message), then start the run again.";
}

/** The second attempt's result, saying so when it failed as the first did. */
export function afterSecondAttempt(first: AgentResult, second: AgentResult): AgentResult {
  // Cut short by Novera's own slice: the first attempt is what was observed.
  if (second.cutByNovera) return first;
  if (second.ok) return second;
  const same = first.statusCode !== undefined && first.statusCode === second.statusCode;
  return {
    ...second,
    error: same
      ? `${second.error ?? `Agent returned HTTP ${second.statusCode}`} on two attempts ${AGENT_RETRY_AFTER_MS / 1000} s apart.`
      : `${second.error ?? "The agent produced no response."} A first attempt ${AGENT_RETRY_AFTER_MS / 1000} s earlier also failed${first.statusCode !== undefined ? ` (HTTP ${first.statusCode})` : ""}.`,
  };
}

// In memory only, for the halt decision: never persisted, never part of a record.
const transportOutcomes = new WeakSet<object>();
const redirectOutcomes = new WeakSet<object>();
const failureOutcomes = new WeakMap<object, { signature: string; kind: string; error: string }>();
function flagTransport<T extends object>(outcome: T, result: AgentResult): T {
  if (isTransportFailure(result)) transportOutcomes.add(outcome);
  else if (isRedirectAnswer(result)) redirectOutcomes.add(outcome);
  if (result.failure) failureOutcomes.set(outcome, { signature: result.failure.signature, kind: result.failure.kind, error: result.error ?? "" });
  return outcome;
}

export interface RunSummary {
  runId: string;
  /** `incomplete` means the time budget ran out; the run is resumable, not failed. */
  status: "completed" | "aborted" | "incomplete";
  cases: RunCaseRecord[];
  /** Answered scenarios still held for grading when the slice ended (0084). */
  held?: number;
  coverage: Coverage;
  byObligation: ObligationCoverage[];
  byCategory: CategoryCoverage[];
  error?: string;
}

/**
 * One scenario, sent to the agent and graded.
 *
 * The single place that decides what a case produced. A suite run calls it for each
 * case; a single-case retest calls it once. They must never diverge — a retest that
 * graded differently from the run would be worse than no retest at all, because the
 * operator would trust it.
 *
 * The rule it enforces: if the agent produced no response, the judge is not called.
 * There is nothing to grade, and asking a judge to grade an absence is how a broken
 * integration turns into a plausible-looking verdict.
 */
/**
 * Time kept back, after the agent's reply, for the read-back and the graders. Model
 * calls are bounded by the case's hard stop; this makes sure some of it is left.
 */
export const GRADING_RESERVE_MS = 10_000;

/**
 * How long past the slice's deadline a case that started before it may still run. The
 * deadline is 42 s into a 60 s function, so this leaves a few seconds to save the case
 * and, on the last slice, seal the report.
 */
export const CASE_GRACE_MS = 13_000;

/**
 * How many times a held case is graded, the first included, before it is recorded as whatever
 * the grading reached (0084), and how long apart. Mistral, the only third vendor on Novera's
 * keys, allows two requests a minute; four gradings half a minute apart give each model that
 * was not heard from about two minutes to come back.
 */
export const MAX_GRADING_ATTEMPTS = 4;
export const HOLD_GAP_MS = 30_000;

/** Assumed for an agent whose pace this slice has not yet seen. */
const UNSEEN_AGENT_MS = 6_000;

/**
 * Time a case needs before its hard stop to be worth starting: its turns at twice the
 * slowest reply seen so far, plus grading. Starting a case that cannot finish would
 * send the agent a message whose answer we then stop waiting for.
 */
export function caseNeedsMs(testCase: SuiteCase, slowestAgentMs: number): number {
  const perTurn = Math.min(AGENT_TIMEOUT_MAX_MS, Math.max(UNSEEN_AGENT_MS, 2 * slowestAgentMs));
  const turns = 1 + (testCase.earlier_turns?.length ?? 0) + (testCase.persona?.max_turns ?? 0);
  return perTurn * turns + GRADING_RESERVE_MS;
}

export async function executeCase(args: {
  testCase: SuiteCase;
  agent: AgentAdapter;
  policy: string;
  judge: RoutedChat;
  /** Reads the customer's own system. Null when none is configured, which is normal. */
  verifier?: VerificationConnector | null;
  /**
   * Whether this agent serves real customers. Undefined means unknown, which is
   * treated as production — the cautious reading, because the cost of guessing wrong
   * is an irreversible action against someone's live system.
   */
  agentIsProduction?: boolean;
  /**
   * Plays the customer in a persona scenario. Defaults to the judge's routed chat —
   * the same connections, so the same funding — on its fast `draft` route.
   */
  simulator?: RoutedChat;
  /**
   * The moment (epoch ms) by which this case must be finished — a little before the
   * platform kills the function. The agent must have answered `GRADING_RESERVE_MS`
   * before it, and every model call is bounded by it. Undefined outside a sliced run.
   */
  hardStop?: number;
  /** The gap before a failed request's one further attempt. `AGENT_RETRY_AFTER_MS` unless a test says otherwise. */
  retryAfterMs?: number;
  /** Called the moment the agent's platform says it is over a limit, so the run slows down. */
  onThrottle?: () => void;
  /** Waits before a throttled message is sent again. `THROTTLE_WAITS_MS` unless a test says otherwise. */
  throttleWaitsMs?: readonly number[];
}): Promise<CaseOutcome> {
  const { testCase, agent, policy, verifier, agentIsProduction, hardStop } = args;
  const judge = hardStop === undefined ? args.judge : withDeadline(args.judge, hardStop);
  const simulator = args.simulator && hardStop !== undefined ? withDeadline(args.simulator, hardStop) : args.simulator;
  const agentDeadline = hardStop === undefined ? undefined : hardStop - GRADING_RESERVE_MS;

  // Nothing irreversible against a live agent by accident. The default is the cautious
  // one: an agent is production unless someone has said otherwise, so a destructive
  // scenario is refused where the answer is unknown rather than attempted.
  if ((testCase.destructive || testCase.fixture_only) && agentIsProduction !== false) {
    return {
      responseText: null,
      toolActivity: null,
      status: "error",
      rationale: null,
      latencyMs: null,
      usage: null,
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      evidenceGap: null,
      settledBy: null,
      observation: null,
      error: testCase.destructive
        ? "This scenario attempts something irreversible and this agent is marked as "
          + "production. It was not run. Mark the agent as a test target (the agent's Connection tab) to run it."
        : "This scenario is written against scripted test data and this agent is marked "
          + "as production. It was not run.",
    };
  }

  // A scenario whose attack arrives on the metadata channel cannot be run against an
  // agent that has no metadata channel. Delivering it in the message instead would
  // quietly convert it into a direct-injection test and report the verdict under this
  // scenario's name, which is the kind of substitution this product exists to refuse.
  if (testCase.context && !agent.acceptsContext()) {
    return {
      responseText: null,
      toolActivity: null,
      status: "error",
      rationale: null,
      latencyMs: null,
      usage: null,
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      evidenceGap: null,
      settledBy: null,
      observation: null,
      error:
        "This scenario delivers its input as conversation metadata, and this agent has "
        + "no {{context}} slot in its request template. It was not run, rather than run "
        + "as a different test. To run it, add the slot, or tick the delivery option on the "
        + "agent's Connection tab: the content is then sent in the message and the report says so.",
    };
  }

  // A conversation needs an agent that can be told what came before. Sending the
  // earlier turns as unrelated messages would test whether each one is refused on its
  // own — a different test from whether a refusal holds — under this scenario's name.
  const earlierTurns = testCase.earlier_turns ?? [];
  const persona = testCase.persona;
  const isConversation = earlierTurns.length > 0 || Boolean(persona);
  if (isConversation && !agent.acceptsConversation?.()) {
    return {
      responseText: null,
      toolActivity: null,
      status: "error",
      rationale: null,
      latencyMs: null,
      usage: null,
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      evidenceGap: null,
      settledBy: null,
      observation: null,
      error:
        "This scenario is a conversation, and this agent's request template has no "
        + "{{history}} or {{conversation_id}} slot to carry one. It was not run, rather "
        + "than run as separate messages. To run it, add a slot, or tick the delivery option on the "
        + "agent's Connection tab: the earlier turns are then sent in the message and the report says so.",
    };
  }

  const conversationId = crypto.randomUUID();
  const transcript: ConversationTurn[] = [];
  const history: Array<{ role: "customer" | "agent"; content: string }> = [];
  const activities: unknown[] = [];
  let slowest = 0;

  // A conversation that stopped part-way produced no verdict on the conversation.
  const unfinished = (error: string, latencyMs: number | null, lastActivity?: unknown): CaseOutcome => ({
    responseText: null,
    toolActivity: mergeToolActivity([...activities, lastActivity]),
    status: "error",
    rationale: null,
    latencyMs,
    usage: null,
    judgeModel: null,
    judgeAttempts: [],
    judgeVotes: [],
    judgeAgreement: null,
    failedAssertions: [],
    evidenceGap: null,
    settledBy: null,
    observation: null,
    transcript: transcript.length >= 2 ? transcript : null,
    error,
  });

  // Every customer message is one turn: the scripted earlier turns, then the
  // scenario's own input, then — for a persona — whatever the simulated customer
  // decides to say next, until it stops or its patience runs out.
  const scripted = [...earlierTurns, testCase.input];
  let simulatedTurns = 0;
  let agentResult: AgentResult | null = null;

  for (let turnNumber = 1; ; turnNumber++) {
    let message: string;
    let simulatedBy: string | null = null;
    if (turnNumber <= scripted.length) {
      message = scripted[turnNumber - 1];
    } else if (persona && simulatedTurns < persona.max_turns) {
      const step = await nextSimulatedMessage(simulator ?? judge, persona, transcript, persona.max_turns - simulatedTurns);
      if ("error" in step) {
        return unfinished(`The simulated customer could not continue after turn ${turnNumber - 1}: ${step.error}`, null);
      }
      if (step.done) break;
      message = step.message;
      simulatedBy = step.model;
      simulatedTurns++;
    } else {
      break;
    }

    // Whatever an adapter does, it costs this scenario at most: a failure here is recorded
    // as the scenario's result, never thrown out to abort the run (audit 2026-10-01, C5).
    let result: AgentResult;
    try {
      result = await agent.send({
        input: message,
        policy,
        ...(agentDeadline !== undefined ? { deadline: agentDeadline } : {}),
        ...(testCase.context ? { context: testCase.context } : {}),
        ...(isConversation ? { history: [...history], conversationId } : {}),
      });
    } catch (thrown) {
      result = {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0,
        error: `The agent could not be asked: ${thrown instanceof Error ? thrown.message : String(thrown)}`,
      };
    }

    // The platform said it is over a limit: wait and send again, while the slice has room.
    const send = () => agent.send({
      input: message,
      policy,
      ...(agentDeadline !== undefined ? { deadline: agentDeadline } : {}),
      ...(testCase.context ? { context: testCase.context } : {}),
      ...(isConversation ? { history: [...history], conversationId } : {}),
    });
    const waits = args.throttleWaitsMs ?? THROTTLE_WAITS_MS;
    const waited: number[] = [];
    while (result.failure?.kind === "throttled") {
      args.onThrottle?.();
      if (waited.length >= waits.length || !mayResendThrottled(result, testCase, turnNumber)) break;
      const pause = result.failure.retryAfterMs ?? waits[waited.length];
      if (agentDeadline !== undefined && Date.now() + pause + 2_000 >= agentDeadline) break;
      await new Promise((resolve) => setTimeout(resolve, pause));
      waited.push(pause);
      let again: AgentResult;
      try {
        again = await send();
      } catch {
        break;
      }
      // Cut short by Novera's own slice: what was observed is the limit.
      if (again.cutByNovera) break;
      result = again;
    }
    if (waited.length && !result.ok) {
      result = { ...result, error: `${result.error ?? "The agent produced no response."} Sent ${waited.length + 1} times, waiting ${waited.map((w) => `${Math.round(w / 100) / 10} s`).join(" and ")} between, while its platform said it was over a limit.` };
    }

    // One more attempt for a request the server failed, when sending it twice cannot act twice:
    // only the first message, because a platform that keeps the conversation itself may already
    // hold a later turn the transcript would then show once.
    if (turnNumber === 1 && worthOneMoreAttempt(result, testCase)) {
      const first = result;
      await new Promise((resolve) => setTimeout(resolve, args.retryAfterMs ?? AGENT_RETRY_AFTER_MS));
      try {
        result = afterSecondAttempt(first, await agent.send({
          input: message,
          policy,
          ...(agentDeadline !== undefined ? { deadline: agentDeadline } : {}),
          ...(testCase.context ? { context: testCase.context } : {}),
          ...(isConversation ? { history: [...history], conversationId } : {}),
        }));
      } catch {
        result = first;
      }
    }

    if (!isConversation) {
      agentResult = result;
      break;
    }

    transcript.push({ role: "customer", content: message, ...(simulatedBy ? { simulated: true, model: simulatedBy } : {}) });
    if (!result.ok || result.responseText === null) {
      return flagTransport(unfinished(
        `Turn ${turnNumber} of the conversation got no reply: ${result.error ?? "the agent produced no response."}`,
        result.latencyMs,
        result.toolActivity,
      ), result);
    }
    transcript.push({ role: "agent", content: result.responseText, latencyMs: result.latencyMs });
    history.push({ role: "customer", content: message }, { role: "agent", content: result.responseText });
    activities.push(result.toolActivity);
    slowest = Math.max(slowest, result.latencyMs);
    agentResult = result;
  }

  if (!agentResult) return unfinished("The conversation produced no turns.", null);
  // Tool activity for a conversation is collected turn by turn above; the final
  // result's own activity is already in `activities`.
  if (isConversation) activities.pop();
  const finalTranscript = isConversation ? transcript : null;

  if (!agentResult.ok || agentResult.responseText === null) {
    return flagTransport({
      responseText: null,
      transcript: finalTranscript,
      toolActivity: agentResult.toolActivity ?? null,
      status: "error",
      rationale: null,
      latencyMs: agentResult.latencyMs,
      usage: null,
      // The judge was never called: there was nothing to grade.
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      // No response is a fault, not an evidence gap. Conflating the two would let a
      // dead endpoint read as "we could not confirm the action", which is far kinder
      // than the truth.
      evidenceGap: null,
      settledBy: null,
      observation: null,
      error: agentResult.error ?? "The agent produced no response.",
    }, agentResult);
  }

  // Deterministic first. A rule that is true or false about the transcript does not
  // need a model's opinion, and a failure it finds is cheaper, stable and quotable —
  // three properties no judge call has. Checks can only fail a case; one that passes
  // them all still goes to the models, because "did not say the forbidden thing" is
  // not "met the expectation".
  // In a conversation, rules apply to everything the agent said and did across every
  // turn: "must not issue a refund" is broken by a refund in turn two, whatever the last
  // reply says. The latency limit applies to the slowest reply.
  const toolActivity = isConversation
    ? mergeToolActivity([...activities, agentResult.toolActivity])
    : agentResult.toolActivity;
  const checkFailures = runChecks(testCase.checks, {
    responseText: isConversation
      ? transcript.filter((t) => t.role === "agent").map((t) => t.content).join("\n\n")
      : agentResult.responseText,
    toolActivity,
    latencyMs: isConversation ? Math.max(slowest, agentResult.latencyMs) : agentResult.latencyMs,
  });

  // Per-turn rules, each against its own turn's reply and tool calls. Listed before the
  // whole-conversation failures, because "crossed at turn 2" is the first thing a
  // reader of this case needs to know.
  const replies = transcript.filter((t) => t.role === "agent");
  for (const { turn, checks } of (isConversation ? testCase.turn_checks ?? [] : [])) {
    const reply = replies[turn - 1];
    if (!reply) continue;
    const activity = turn - 1 < activities.length ? activities[turn - 1] : agentResult.toolActivity;
    const found = runChecks(checks, { responseText: reply.content, toolActivity: activity, latencyMs: reply.latencyMs ?? null });
    checkFailures.unshift(...found.map((f) => ({ ...f, why: `Turn ${turn} of ${replies.length}: ${f.why}` })));
  }

  if (checkFailures.length > 0) {
    return {
      responseText: agentResult.responseText,
      transcript: finalTranscript,
      toolActivity: toolActivity ?? null,
      status: "fail",
      rationale: describeFailures(checkFailures),
      latencyMs: agentResult.latencyMs,
      usage: { agent: agentResult.usage ?? null, judge: {} },
      // No model was asked, so there is nothing to attribute or corroborate. Saying
      // "graded by X" or "uncorroborated" here would both be untrue.
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      evidenceGap: null,
      settledBy: "deterministic",
      observation: null,
      error: null,
    };
  }

  // The read-back, before the models. A scenario that expects a change of state can
  // be settled by the customer's own system saying it did not happen, and that is a
  // stronger and cheaper finding than any verdict a model could give.
  let observation: VerificationObservation | null = null;
  if (verifier && testCase.effect?.evidence === "state_confirmed" && testCase.effect.verify) {
    observation = await verifier.verify({
      caseId: testCase.id,
      path: testCase.effect.verify.path,
      expect: testCase.effect.verify.expect,
      ...(testCase.effect.verify.not_found_means === "contradicted" ? { notFoundMeans: "contradicted" as const } : {}),
    });
  }

  if (observation?.status === "contradicted") {
    // The agent said it did something and the customer's own system says otherwise.
    // No model is asked: there is nothing left for one to weigh.
    return {
      responseText: agentResult.responseText,
      transcript: finalTranscript,
      toolActivity: toolActivity ?? null,
      status: "fail",
      rationale: observation.detail,
      latencyMs: agentResult.latencyMs,
      usage: { agent: agentResult.usage ?? null, judge: {} },
      judgeModel: null,
      judgeAttempts: [],
      judgeVotes: [],
      judgeAgreement: null,
      failedAssertions: [],
      evidenceGap: null,
      settledBy: "read_back",
      observation,
      error: null,
    };
  }

  return gradeWithModels({
    testCase, judge, observation,
    executed: {
      responseText: agentResult.responseText,
      transcript: finalTranscript,
      toolActivity: toolActivity ?? null,
      latencyMs: agentResult.latencyMs,
      agentUsage: agentResult.usage ?? null,
    },
  });
}

/** A case as it was executed, before the models graded it: what a held case keeps (0084). */
export interface ExecutedCase {
  responseText: string;
  /** Every turn of a conversation scenario; null for a single message. */
  transcript: ConversationTurn[] | null;
  toolActivity: unknown;
  latencyMs: number | null;
  agentUsage: unknown;
}

/**
 * The model-graded end of a case: consensus over the reply, then the effect rule. One function
 * for a case graded as it ran and for a held case resumed in a later slice (0084), so a resumed
 * case is graded exactly as a fresh one would have been.
 */
export async function gradeWithModels(args: {
  testCase: SuiteCase;
  judge: RoutedChat;
  executed: ExecutedCase;
  observation: VerificationObservation | null;
  resume?: PendingGrading;
}): Promise<CaseOutcome> {
  const { testCase, judge, executed, observation, resume } = args;
  const transcript = executed.transcript;
  const isConversation = transcript !== null;

  // Two models must agree. A single judge was measured at 25% verdict drift on
  // identical responses (npm run measure:stability), which would have shown up in a
  // customer's rerun as fixes and regressions that never happened.
  const verdict = await gradeCase({
    chat: judge,
    severity: testCase.severity,
    testCase: {
      caseId: testCase.id,
      input: isConversation ? conversationInput(transcript) : testCase.input,
      expectedBehavior: testCase.expected_behavior,
      assertions: testCase.assertions,
      forbidden: testCase.forbidden,
    },
    agentResponse: isConversation ? conversationResponse(transcript) : executed.responseText,
    toolActivity: executed.toolActivity,
    ...(resume ? { resume } : {}),
  });

  // Deterministic, and applied after grading rather than inside the prompt: whether
  // evidence exists is a fact about the run, not a judgement about the response.
  const ruled = applyEffectRule({
    effect: testCase.effect,
    status: verdict.status,
    rationale: verdict.rationale,
    error: verdict.error,
    toolActivity: executed.toolActivity,
    observation,
  });

  return {
    responseText: executed.responseText,
    transcript,
    toolActivity: executed.toolActivity,
    status: ruled.status,
    rationale: ruled.rationale,
    latencyMs: executed.latencyMs,
    usage: {
      agent: executed.agentUsage,
      judge: verdict.usage,
    },
    judgeModel: verdict.servedBy ? `${verdict.servedBy.connection}/${verdict.servedBy.model}` : null,
    judgeAttempts: verdict.attempts,
    judgeVotes: verdict.votes,
    judgeAgreement: verdict.agreement,
    failedAssertions: verdict.failedAssertions,
    evidenceGap: ruled.evidenceGap,
    settledBy: "models",
    observation,
    error: ruled.error,
    // Never stored on the row: what a later slice needs to finish the grading (0084).
    ...(verdict.pending ? { gradingPending: verdict.pending } : {}),
  };
}

/**
 * The simulated customer's next message, or its decision to stop.
 *
 * Temperature 0, so a persona conversation varies as little as the models allow — it
 * still varies, which is why a simulated conversation is labelled as one and never
 * presented as a real customer. The simulator never sees the scenario's assertions.
 */
async function nextSimulatedMessage(
  chat: RoutedChat,
  persona: Persona,
  transcript: ConversationTurn[],
  turnsLeft: number,
): Promise<{ done: true } | { done: false; message: string; model: string } | { error: string }> {
  // A reply that cannot be read gets one more try from a different model: the router
  // falls back on a failed call, not on a readable-but-wrong answer, and one garbled
  // line should not cost the whole conversation. Measured once in verify:conversation.
  const exclude: Array<{ connection: string; model: string }> = [];
  let last: { error: string } = { error: "The simulated customer's reply was unreadable." };
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await chat("draft", {
        system: SIMULATOR_SYSTEM,
        messages: [{ role: "user", content: simulatorPrompt(persona, transcript, turnsLeft) }],
        maxTokens: 400,
        temperature: 0,
      }, { data: "redacted_customer", exclude });
      const step = parseSimulatorReply(extractJsonObject(response.text) as Record<string, unknown> | null);
      if (!("error" in step)) {
        return step.done ? step : { done: false, message: step.message, model: `${response.servedBy.connection}/${response.servedBy.model}` };
      }
      last = step;
      exclude.push(response.servedBy);
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }
  return last;
}

/**
 * Whether this case produced no verdict *only* because every grading vendor refused
 * on quota.
 *
 * Deliberately strict: every recorded attempt must be a rate limit, and there must
 * have been at least one. A case where the agent itself died, or where one vendor was
 * rate-limited and another returned something unreadable, is an ordinary error and
 * must keep being reported as one.
 */
function everyJudgeRateLimited(record: RunCaseRecord): boolean {
  if (record.status !== "error") return false;
  // A candidate not sent the request for privacy reasons was never rate-limited.
  const attempts = (record.judgeAttempts as Array<{ ok?: boolean; error?: string; refused?: boolean; reason?: string }>)
    ?.filter((a) => !a.refused && a.reason !== "refused_data_class");
  if (!Array.isArray(attempts) || attempts.length === 0) return false;
  // The typed reason when the attempt has one; the words for rows from before it did. A
  // vendor skipped because it was rate-limited earlier in the slice counts as limited.
  return attempts.every(
    (a) => a.ok === false && (a.reason === "rate_limited"
      || ((a.reason === "skipped_open_circuit" || a.reason === "paced") && /rate-limited/.test(a.error ?? ""))
      || (!a.reason && /rate.?limit|429|quota|too many requests/i.test(a.error ?? ""))),
  );
}

/**
 * Runs every case in the suite against the live agent and grades each response.
 *
 * Two rules drive the shape of this function:
 *  - One case must never end the run. A dead endpoint on case 3 still leaves 13
 *    cases of evidence, and the 3rd is recorded as an error.
 *  - If the agent did not produce a response, the judge is not called at all.
 *    There is nothing to grade, and asking the judge to grade an absence is how a
 *    broken integration turns into a plausible-looking verdict.
 */
/**
 * The check message before a run's first scenario. A limit, an unreachable endpoint or a failed
 * workflow step is given one more chance after a short wait (the first request of a run often
 * meets a cold start); a
 * slice that is ending sends nothing and decides nothing. Returns the halt sentence, or null when
 * the connection answered.
 */
export async function probeBeforeFirst(agent: AgentAdapter, deadline?: number, waitMs = 2_000): Promise<string | null> {
  const ask = async (): Promise<AgentResult> => {
    try {
      return await agent.probe();
    } catch (thrown) {
      return { ok: false, responseText: null, toolActivity: null, latencyMs: 0, error: `The agent could not be asked: ${thrown instanceof Error ? thrown.message : String(thrown)}` };
    }
  };
  let check = await ask();
  if (check.ok || check.cutByNovera) return null;
  // A limit, a cold start, or a workflow step whose dependency failed once.
  const transient = check.failure ? ["throttled", "unreachable", "timeout"].includes(check.failure.kind) || check.failure.transient === true : isTransportFailure(check);
  const pause = check.failure?.retryAfterMs ?? waitMs;
  if (transient && (deadline === undefined || Date.now() + pause + 5_000 < deadline)) {
    await new Promise((resolve) => setTimeout(resolve, pause));
    check = await ask();
    if (check.ok || check.cutByNovera) return null;
  }
  return haltBeforeFirst(check.error ?? "the agent produced no response.");
}

export async function executeRun(args: ExecuteRunArgs): Promise<RunSummary> {
  const { runId, suite, agent, policy, judge, store, skipCaseIds, deadline } = args;
  const concurrency = args.oneAtATime ? 1 : args.concurrency ?? 3;
  const paceMs = Math.max(0, args.paceMs ?? 0);

  await store.markRunning(runId);

  const alreadyDone = new Set(skipCaseIds ?? []);
  const records = new Array<RunCaseRecord>(suite.cases.length);
  let cursor = 0;
  let ranOutOfTime = false;

  /**
   * How many cases in a row produced no verdict because every grading vendor was
   * rate-limited.
   *
   * This exists because of what the two outcomes mean to a customer. A case that
   * errored is `WITHHELD` — "the run finished and the evidence does not support a
   * grade", which tells them to go and fix something. A case that never ran is
   * `INCOMPLETE` — "run it again". When every vendor's free tier is exhausted, the
   * second is the true statement and the first is a small lie that sends someone
   * hunting for a fault in their own agent.
   *
   * Two in a row, not one: a single unlucky case can hit a limit that the next case
   * clears.
   */
  let consecutiveQuotaFailures = 0;
  let quotaExhausted = false;

  // The last moment a case may still be running, and what this slice has learned about
  // how long the agent takes. A slice always starts at least one case, so a run whose
  // single case needs more than a slice still moves; after that, a case starts only if
  // it can finish.
  const hardStop = deadline === undefined ? undefined : deadline + CASE_GRACE_MS;
  let slowestAgentMs = 0;
  let startedThisSlice = 0;
  let stopped = false;
  // Another slice took the run over (0047): it sends and records what is left.
  let lostLease = false;
  // Pacing: the next moment a send may start, reserved synchronously so workers queue.
  let nextSendAt = 0;
  // Consecutive agent transport failures, in completion order. With several workers a
  // success can complete after failures that were sent later; it says nothing about whether
  // the endpoint recovered, so only a success sent after the latest failure ends the streak
  // (chaos audit 2026-10-17: a WAF's late-answered successes let six refusals through).
  let consecutiveTransport = 0;
  let transportHalted = false;
  // Redirects count in their own streak, by the same send-order rule: a halt says one cause.
  let consecutiveRedirect = 0;
  let redirectHalted = false;
  let lastRedirectSeq = 0;
  let sendSeq = 0;
  let lastTransportSeq = 0;
  // The last transport failure's sentence, so a halt says what the platform said.
  let lastTransportError = "";
  // A platform that said it is over a limit: from then on one scenario at a time, with a gap
  // that doubles with each further limit (`SLOW_GAP_START_MS` → `SLOW_GAP_MAX_MS`).
  const gapStart = args.slowGapStartMs ?? SLOW_GAP_START_MS;
  const gapMax = gapStart * (SLOW_GAP_MAX_MS / SLOW_GAP_START_MS);
  let slowGap = args.startSlow ? gapStart : 0;
  let inFlight = 0;
  const onThrottle = () => { slowGap = slowGap ? Math.min(slowGap * 2, gapMax) : gapStart; };
  // One cause repeating (`CONNECTION_HALT_PREFIX`): its signature, how many in a row by send
  // order, and causes a check message already showed to be about the scenarios, not the connection.
  let streak: { signature: string; count: number; lastSeq: number } | null = null;
  const clearedSignatures = new Set<string>();
  let probing = false;
  let connectionHalt: string | null = null;

  // Held cases (0084): never sent again; graded where their grading stopped, once due.
  const outstanding = new Map<string, HeldCase>((args.held ?? []).map((h) => [h.caseId, h]));
  for (const id of outstanding.keys()) alreadyDone.add(id);
  const caseRecord = (testCase: SuiteCase, outcome: CaseOutcome): RunCaseRecord => {
    const stored = { ...outcome };
    delete stored.gradingPending;
    return {
      runId,
      caseId: testCase.id,
      category: testCase.category,
      obligation: testCase.obligation,
      severity: testCase.severity,
      input: testCase.input,
      expected: testCase.expected_behavior,
      assertions: testCase.assertions,
      ...stored,
    };
  };
  /** Holds the case if its grading can still finish later; false when it is recorded now instead. */
  async function holdIfPending(testCase: SuiteCase, outcome: CaseOutcome, gradedTimes: number): Promise<boolean | "not_holder"> {
    if (!outcome.gradingPending || !store.holdCase || outcome.responseText === null || gradedTimes >= MAX_GRADING_ATTEMPTS) return false;
    const held: HeldCase = {
      caseId: testCase.id,
      executed: {
        responseText: outcome.responseText,
        transcript: outcome.transcript ?? null,
        toolActivity: outcome.toolActivity,
        latencyMs: outcome.latencyMs,
        agentUsage: (outcome.usage as { agent?: unknown } | null)?.agent ?? null,
      },
      observation: outcome.observation,
      grading: outcome.gradingPending,
      attempts: gradedTimes,
      notBefore: Date.now() + (args.holdGapMs ?? HOLD_GAP_MS),
    };
    const answer = await store.holdCase(runId, held);
    if (answer === "not_holder") return "not_holder";
    if (answer === "unavailable") return false;
    outstanding.set(testCase.id, held);
    return true;
  }
  async function resumeDue(): Promise<void> {
    for (const held of [...outstanding.values()].sort((x, y) => x.notBefore - y.notBefore)) {
      if (held.notBefore > Date.now()) continue;
      if (deadline !== undefined && Date.now() >= deadline) return;
      if (stopped || lostLease) return;
      const index = suite.cases.findIndex((c) => c.id === held.caseId);
      if (index < 0) {
        // Not a scenario this run declared: nothing of it can be recorded.
        outstanding.delete(held.caseId);
        await store.releaseHold?.(runId, held.caseId);
        continue;
      }
      const testCase = suite.cases[index];
      const outcome = await gradeWithModels({
        testCase,
        judge: hardStop === undefined ? judge : withDeadline(judge, hardStop),
        executed: held.executed,
        observation: held.observation,
        resume: held.grading,
      });
      const again = await holdIfPending(testCase, outcome, held.attempts + 1);
      if (again === "not_holder") { lostLease = true; return; }
      if (again) continue;
      const saved = await store.saveCase(caseRecord(testCase, outcome));
      if (saved === "not_holder") { lostLease = true; return; }
      outstanding.delete(held.caseId);
      await store.releaseHold?.(runId, held.caseId);
      if (saved !== "already_recorded") records[index] = caseRecord(testCase, outcome);
    }
  }

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= suite.cases.length) return;
      const testCase = suite.cases[index];
      if (alreadyDone.has(testCase.id)) continue;

      // Checked before starting a case, never in the middle of one: a case that has
      // been sent to the agent is always graded and saved.
      if (deadline !== undefined && Date.now() >= deadline) {
        ranOutOfTime = true;
        return;
      }

      // Same rule as the deadline: checked before a case starts, never during one.
      if (quotaExhausted) {
        ranOutOfTime = true;
        return;
      }

      if (transportHalted || redirectHalted || connectionHalt) return;

      // Slowed by a limit: wait until nothing else is in flight, so one scenario is sent at a time.
      while (slowGap > 0 && inFlight > 0) {
        if (transportHalted || redirectHalted || connectionHalt || stopped || lostLease) return;
        if (deadline !== undefined && Date.now() >= deadline) {
          ranOutOfTime = true;
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      inFlight++;
      let outcome: CaseOutcome;
      const seq = ++sendSeq;
      try {
        const gap = Math.max(paceMs, slowGap);
        if (gap > 0) {
          const slot = Math.max(Date.now(), nextSendAt);
          // Waiting out the gap must not carry the send past the slice.
          if ((deadline !== undefined && slot >= deadline) || (hardStop !== undefined && slot >= hardStop)) {
            ranOutOfTime = true;
            return;
          }
          nextSendAt = slot + gap;
          const wait = slot - Date.now();
          if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
          if (transportHalted || redirectHalted || connectionHalt) return;
        }

        // A person pressed Stop: no further message goes to their agent.
        if (stopped || (store.isStopped && await store.isStopped(runId))) {
          stopped = true;
          return;
        }
        // Nor from a slice that no longer holds the run: the one that took it over sends
        // what is left. Checked before each scenario, never in the middle of one.
        if (lostLease || (store.holdsRun && !(await store.holdsRun(runId)))) {
          lostLease = true;
          return;
        }

        if (hardStop !== undefined && startedThisSlice > 0 && hardStop - Date.now() < caseNeedsMs(testCase, slowestAgentMs)) {
          ranOutOfTime = true;
          return;
        }
        startedThisSlice++;

        outcome = await executeCase({
          testCase, agent, policy, judge,
          verifier: args.verifier,
          agentIsProduction: args.agentIsProduction,
          hardStop,
          onThrottle,
          ...(args.throttleWaitsMs ? { throttleWaitsMs: args.throttleWaitsMs } : {}),
        });
      } finally {
        inFlight--;
      }
      records[index] = caseRecord(testCase, outcome);
      slowestAgentMs = Math.max(slowestAgentMs, records[index].latencyMs ?? 0);
      // The agent answered and only grading capacity is missing: keep the reply and finish the
      // grading in a later slice rather than record a no-result Novera caused (0084). Counted
      // for the quota stop below like any case whose graders were all rate-limited.
      const heldNow = await holdIfPending(testCase, outcome, 1);
      if (heldNow === "not_holder") {
        delete records[index];
        lostLease = true;
        return;
      }
      if (heldNow) {
        if (seq > lastTransportSeq) consecutiveTransport = 0;
        if (seq > lastRedirectSeq) consecutiveRedirect = 0;
        if (streak && seq > streak.lastSeq) streak = null;
        if (everyJudgeRateLimited(records[index])) {
          consecutiveQuotaFailures++;
          if (consecutiveQuotaFailures >= 2) quotaExhausted = true;
        } else {
          consecutiveQuotaFailures = 0;
        }
        delete records[index];
        continue;
      }
      const saved = await store.saveCase(records[index]);
      if (saved === "not_holder" || saved === "already_recorded") {
        // Not this slice's evidence to count: either nothing was stored, or the run already
        // holds this scenario. The stored row is the record.
        delete records[index];
        if (saved === "not_holder") {
          lostLease = true;
          return;
        }
        continue;
      }

      if (transportOutcomes.has(outcome)) {
        consecutiveTransport++;
        lastTransportSeq = Math.max(lastTransportSeq, seq);
        lastTransportError = records[index].error ?? "";
        if (consecutiveTransport >= TRANSPORT_HALT_AFTER) transportHalted = true;
      } else if (seq > lastTransportSeq) {
        consecutiveTransport = 0;
      }

      // One cause repeating, by the same send-order rule as transport failures.
      const failure = failureOutcomes.get(outcome);
      if (failure && BREAKER_KINDS.has(failure.kind) && !clearedSignatures.has(failure.signature)) {
        streak = streak && streak.signature === failure.signature
          ? { signature: failure.signature, count: streak.count + 1, lastSeq: Math.max(streak.lastSeq, seq) }
          : { signature: failure.signature, count: 1, lastSeq: seq };
        if (streak.count >= TRANSPORT_HALT_AFTER && !probing && !connectionHalt) {
          probing = true;
          const repeated = streak.signature;
          let check: AgentResult;
          try {
            check = await agent.probe();
          } catch (thrown) {
            check = { ok: false, responseText: null, toolActivity: null, latencyMs: 0, error: thrown instanceof Error ? thrown.message : String(thrown) };
          }
          probing = false;
          if (check.ok || check.cutByNovera) {
            // The connection answers: the cause is in those scenarios. Not probed for again.
            clearedSignatures.add(repeated);
            streak = null;
          } else {
            connectionHalt = haltAfterRepeat(failure.error, check.error, check.failure?.signature === repeated);
          }
        }
      } else if (streak && seq > streak.lastSeq) {
        streak = null;
      }
      if (redirectOutcomes.has(outcome)) {
        consecutiveRedirect++;
        lastRedirectSeq = Math.max(lastRedirectSeq, seq);
        if (consecutiveRedirect >= TRANSPORT_HALT_AFTER) redirectHalted = true;
      } else if (seq > lastRedirectSeq) {
        consecutiveRedirect = 0;
      }

      if (everyJudgeRateLimited(records[index])) {
        consecutiveQuotaFailures++;
        if (consecutiveQuotaFailures >= 2) quotaExhausted = true;
      } else {
        consecutiveQuotaFailures = 0;
      }
    }
  }

  let status: "completed" | "aborted" | "incomplete" = "completed";
  let error: string | undefined;

  try {
    // A run that has recorded nothing yet proves the connection first, with one harmless message.
    if (args.probeFirst && alreadyDone.size === 0 && outstanding.size === 0) {
      connectionHalt = await probeBeforeFirst(agent, deadline);
    }
    await resumeDue();
    if (!connectionHalt) await Promise.all(Array.from({ length: Math.min(concurrency, suite.cases.length) }, worker));
    // Only held cases left: wait for the next one to fall due if this slice has room for it,
    // rather than end the slice and leave the run waiting on the next call.
    while (outstanding.size > 0 && !ranOutOfTime && !stopped && !lostLease && !transportHalted && !redirectHalted) {
      // Each pass grades at least the earliest hold, which is then recorded or held again with
      // one more attempt counted, so this ends.
      const due = Math.min(...[...outstanding.values()].map((h) => h.notBefore));
      if (deadline !== undefined && Math.max(due, Date.now()) >= deadline) break;
      const wait = due - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await resumeDue();
    }
  } catch (thrown) {
    // Reaching here means the failure was outside a case (a store write, say).
    // The run is aborted and says so; the cases already saved remain valid evidence.
    status = "aborted";
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  // Three in a row could not reach the agent: the run ends here, aborted, never sealed.
  // A catch-path error, a stop or a lost lease keeps its own precedence below.
  if (transportHalted && status === "completed" && !stopped && !lostLease) {
    status = "aborted";
    const said = quotedReason(lastTransportError);
    error = said ? `${TRANSPORT_HALT_MESSAGE} The agent's platform said: "${said}".` : TRANSPORT_HALT_MESSAGE;
  } else if (redirectHalted && status === "completed" && !stopped && !lostLease) {
    status = "aborted";
    error = REDIRECT_HALT_MESSAGE;
  } else if (connectionHalt && status === "completed" && !stopped && !lostLease) {
    status = "aborted";
    error = connectionHalt;
  }

  const saved = records.filter(Boolean);

  // Left running on purpose when time ran out: the run is not finished, and marking
  // it finished would publish a report over partial evidence.
  const superseded = "Another slice took this run over and continues it; this one stopped before sending anything more.";
  if (stopped) {
    // Already recorded as stopped, with who stopped it; nothing to write.
    status = "aborted";
  } else if (lostLease) {
    // Not finished and not failed: another slice holds the run and writes its outcome.
    status = "incomplete";
    error = superseded;
  } else if (status === "completed" && (ranOutOfTime || outstanding.size > 0)) {
    if (quotaExhausted) {
      error =
        "Every grading vendor was rate-limited, so the remaining scenarios were not started. "
        + "They are recorded as not run rather than as failures, because nothing about the agent was learned. "
        + "Run the suite again when the quota has recovered.";
    }
    status = "incomplete";
  } else if ((await store.finishRun(runId, { status, error })) === false) {
    // Nothing was written: a person stopped the run meanwhile, or another slice took it over.
    if (store.isStopped && await store.isStopped(runId)) {
      status = "aborted";
    } else {
      status = "incomplete";
      error = superseded;
    }
  }

  const plannedByObligation: Record<string, number> = {};
  const plannedByCategory: Record<string, number> = {};
  for (const c of suite.cases) {
    plannedByObligation[c.obligation] = (plannedByObligation[c.obligation] ?? 0) + 1;
    plannedByCategory[c.category] = (plannedByCategory[c.category] ?? 0) + 1;
  }

  // Which scenarios asked for proof beyond the agent's words. Read from the suite,
  // not from the stored rows: a case that never ran still counts in the denominator.
  const requiresEvidence = new Set(suite.cases.filter((c) => c.effect).map((c) => c.id));

  return {
    runId,
    status,
    cases: saved,
    ...(outstanding.size > 0 ? { held: outstanding.size } : {}),
    coverage: coverage({
      plannedCases: suite.cases.length,
      // Mapped, not spread: the record calls it `judgeAgreement` and coverage calls
      // it `agreement`, and a silent name mismatch here would zero the disputed
      // count without failing anything. The assertion counts are named differently
      // again, because a record's `assertions` is the strings and coverage wants how
      // many of them there are.
      cases: saved.map((c) => ({
        status: c.status,
        error: c.error,
        agreement: c.judgeAgreement,
        evidenceGap: c.evidenceGap,
        assertionCount: c.assertions.length,
        failedAssertionCount: c.failedAssertions.length,
        requiresEvidence: requiresEvidence.has(c.caseId),
        settledBy: c.settledBy,
        observationStatus: c.observation?.status ?? null,
      })),
    }),
    byObligation: coverageByObligation(saved, plannedByObligation),
    byCategory: coverageByCategory(saved, plannedByCategory),
    error,
  };
}
