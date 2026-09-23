import type { AgentAdapter } from "../agents/types.ts";
import type { RoutedChat } from "../router/execute.ts";
import { gradeCase } from "../judge/consensus.ts";
import { applyEffectRule } from "../judge/effect.ts";
import { coverage, coverageByObligation, coverageByCategory, type Coverage, type ObligationCoverage, type CategoryCoverage } from "../evidence/coverage.ts";
import type { CaseOutcome, RunCaseRecord, RunStore, Suite, SuiteCase } from "./types.ts";

export interface ExecuteRunArgs {
  runId: string;
  suite: Suite;
  agent: AgentAdapter;
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
export async function executeCase(args: {
  testCase: SuiteCase;
  agent: AgentAdapter;
  policy: string;
  judge: RoutedChat;
}): Promise<CaseOutcome> {
  const { testCase, agent, policy, judge } = args;

  const agentResult = await agent.send({ input: testCase.input, policy });

  if (!agentResult.ok || agentResult.responseText === null) {
    return {
      responseText: null,
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
      error: agentResult.error ?? "The agent produced no response.",
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
      input: testCase.input,
      expectedBehavior: testCase.expected_behavior,
      assertions: testCase.assertions,
      forbidden: testCase.forbidden,
    },
    agentResponse: agentResult.responseText,
    toolActivity: agentResult.toolActivity,
  });

  // Deterministic, and applied after grading rather than inside the prompt: whether
  // evidence exists is a fact about the run, not a judgement about the response.
  const ruled = applyEffectRule({
    effect: testCase.effect,
    status: verdict.status,
    rationale: verdict.rationale,
    error: verdict.error,
    toolActivity: agentResult.toolActivity,
  });

  return {
    responseText: agentResult.responseText,
    toolActivity: agentResult.toolActivity ?? null,
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
    error: ruled.error,
  };
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
  const attempts = record.judgeAttempts as Array<{ ok?: boolean; error?: string }>;
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

      records[index] = {
        runId,
        caseId: testCase.id,
        category: testCase.category,
        obligation: testCase.obligation,
        severity: testCase.severity,
        input: testCase.input,
        expected: testCase.expected_behavior,
        assertions: testCase.assertions,
        ...(await executeCase({ testCase, agent, policy, judge })),
      };
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
      })),
    }),
    byObligation: coverageByObligation(saved, plannedByObligation),
    byCategory: coverageByCategory(saved, plannedByCategory),
    error,
  };
}
