import type { AgentAdapter, AgentResult } from "../agents/types.ts";
import { extractJsonObject } from "../judge/parse.ts";
import { SIMULATOR_SYSTEM, parseSimulatorReply, simulatorPrompt, type Persona } from "../simulate/persona.ts";
import { withDeadline, type RoutedChat } from "../router/execute.ts";
import { AGENT_TIMEOUT_MAX_MS } from "../agents/http.ts";
import { gradeCase } from "../judge/consensus.ts";
import { applyEffectRule } from "../judge/effect.ts";
import { runChecks, describeFailures } from "../judge/checks.ts";
import type { VerificationConnector, VerificationObservation } from "../evidence/connectors/types.ts";
import { coverage, coverageByObligation, coverageByCategory, type Coverage, type ObligationCoverage, type CategoryCoverage } from "../evidence/coverage.ts";
import type { CaseOutcome, ConversationTurn, RunCaseRecord, RunStore, Suite, SuiteCase } from "./types.ts";
import { conversationInput, conversationResponse, mergeToolActivity } from "./conversation.ts";

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
   * Stop picking up new cases after this moment.
   *
   * Serverless functions are killed at a fixed ceiling with no warning and no chance
   * to record anything. Stopping ourselves a little early turns that into an ordinary
   * `incomplete` result the caller can resume, instead of a run stuck at "running"
   * with half its evidence and no explanation.
   */
  deadline?: number;
}

export interface RunSummary {
  runId: string;
  /** `incomplete` means the time budget ran out; the run is resumable, not failed. */
  status: "completed" | "aborted" | "incomplete";
  cases: RunCaseRecord[];
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
          + "production. It was not run. Mark the agent as a test target to run it."
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
        + "as a different test.",
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
        + "than run as separate messages.",
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

    const result = await agent.send({
      input: message,
      policy,
      ...(agentDeadline !== undefined ? { deadline: agentDeadline } : {}),
      ...(testCase.context ? { context: testCase.context } : {}),
      ...(isConversation ? { history: [...history], conversationId } : {}),
    });

    if (!isConversation) {
      agentResult = result;
      break;
    }

    transcript.push({ role: "customer", content: message, ...(simulatedBy ? { simulated: true, model: simulatedBy } : {}) });
    if (!result.ok || result.responseText === null) {
      return unfinished(
        `Turn ${turnNumber} of the conversation got no reply: ${result.error ?? "the agent produced no response."}`,
        result.latencyMs,
        result.toolActivity,
      );
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
    return {
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
    };
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
    agentResponse: isConversation ? conversationResponse(transcript) : agentResult.responseText,
    toolActivity,
  });

  // Deterministic, and applied after grading rather than inside the prompt: whether
  // evidence exists is a fact about the run, not a judgement about the response.
  const ruled = applyEffectRule({
    effect: testCase.effect,
    status: verdict.status,
    rationale: verdict.rationale,
    error: verdict.error,
    toolActivity,
    observation,
  });

  return {
    responseText: agentResult.responseText,
    transcript: finalTranscript,
    toolActivity: toolActivity ?? null,
    status: ruled.status,
    rationale: ruled.rationale,
    latencyMs: agentResult.latencyMs,
    usage: {
      agent: agentResult.usage ?? null,
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
  try {
    const response = await chat("draft", {
      system: SIMULATOR_SYSTEM,
      messages: [{ role: "user", content: simulatorPrompt(persona, transcript, turnsLeft) }],
      maxTokens: 400,
      temperature: 0,
    }, { data: "redacted_customer" });
    const step = parseSimulatorReply(extractJsonObject(response.text) as Record<string, unknown> | null);
    if ("error" in step || step.done) return step;
    return { done: false, message: step.message, model: `${response.servedBy.connection}/${response.servedBy.model}` };
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
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
  const attempts = (record.judgeAttempts as Array<{ ok?: boolean; error?: string; refused?: boolean }>)
    ?.filter((a) => !a.refused);
  if (!Array.isArray(attempts) || attempts.length === 0) return false;
  return attempts.every(
    (a) => a.ok === false && /rate.?limit|429|quota|too many requests/i.test(a.error ?? ""),
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
export async function executeRun(args: ExecuteRunArgs): Promise<RunSummary> {
  const { runId, suite, agent, policy, judge, store, concurrency = 3, skipCaseIds, deadline } = args;

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

      if (hardStop !== undefined && startedThisSlice > 0 && hardStop - Date.now() < caseNeedsMs(testCase, slowestAgentMs)) {
        ranOutOfTime = true;
        return;
      }
      startedThisSlice++;

      records[index] = {
        runId,
        caseId: testCase.id,
        category: testCase.category,
        obligation: testCase.obligation,
        severity: testCase.severity,
        input: testCase.input,
        expected: testCase.expected_behavior,
        assertions: testCase.assertions,
        ...(await executeCase({
          testCase, agent, policy, judge,
          verifier: args.verifier,
          agentIsProduction: args.agentIsProduction,
          hardStop,
        })),
      };
      slowestAgentMs = Math.max(slowestAgentMs, records[index].latencyMs ?? 0);
      await store.saveCase(records[index]);

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
    await Promise.all(Array.from({ length: Math.min(concurrency, suite.cases.length) }, worker));
  } catch (thrown) {
    // Reaching here means the failure was outside a case (a store write, say).
    // The run is aborted and says so; the cases already saved remain valid evidence.
    status = "aborted";
    error = thrown instanceof Error ? thrown.message : String(thrown);
  }

  const saved = records.filter(Boolean);

  // Left running on purpose when time ran out: the run is not finished, and marking
  // it finished would publish a report over partial evidence.
  if (status === "completed" && ranOutOfTime) {
    if (quotaExhausted) {
      error =
        "Every grading vendor was rate-limited, so the remaining scenarios were not started. "
        + "They are recorded as not run rather than as failures, because nothing about the agent was learned. "
        + "Run the suite again when the quota has recovered.";
    }
    status = "incomplete";
  } else {
    await store.finishRun(runId, { status, error });
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
    coverage: coverage({
      plannedCases: suite.cases.length,
      // Mapped, not spread: the record calls it `judgeAgreement` and coverage calls
      // it `agreement`, and a silent name mismatch here would zero the disputed
      // count without failing anything. The assertion counts are named differently
      // again, because a record's `assertions` is the strings and coverage wants how
      // many of them there are.
      cases: saved.map((c) => ({
        status: c.status,
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
