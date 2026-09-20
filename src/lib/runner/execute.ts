import type { AgentAdapter } from "../agents/types.ts";
import type { RoutedChat } from "../router/execute.ts";
import { gradeCase } from "../judge/consensus.ts";
import { coverage, coverageByObligation, type Coverage, type ObligationCoverage } from "../evidence/coverage.ts";
import type { RunCaseRecord, RunStore, Suite } from "./types.ts";

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
  error?: string;
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

      const base = {
        runId,
        caseId: testCase.id,
        category: testCase.category,
        obligation: testCase.obligation,
        severity: testCase.severity,
        input: testCase.input,
        expected: testCase.expected_behavior,
        assertions: testCase.assertions,
      };

      const agentResult = await agent.send({ input: testCase.input, policy });

      if (!agentResult.ok || agentResult.responseText === null) {
        records[index] = {
          ...base,
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
          error: agentResult.error ?? "The agent produced no response.",
        };
        await store.saveCase(records[index]);
        continue;
      }

      // Two models must agree. A single judge was measured at 25% verdict drift on
      // identical responses (npm run measure:stability), which would have shown up
      // in a customer's rerun as fixes and regressions that never happened.
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

      records[index] = {
        ...base,
        responseText: agentResult.responseText,
        toolActivity: agentResult.toolActivity ?? null,
        status: verdict.status,
        rationale: verdict.rationale,
        latencyMs: agentResult.latencyMs,
        usage: {
          agent: agentResult.usage ?? null,
          judge: verdict.usage,
        },
        judgeModel: verdict.servedBy ? `${verdict.servedBy.connection}/${verdict.servedBy.model}` : null,
        judgeAttempts: verdict.attempts,
        judgeVotes: verdict.votes,
        judgeAgreement: verdict.agreement,
        error: verdict.error,
      };
      await store.saveCase(records[index]);
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
    status = "incomplete";
  } else {
    await store.finishRun(runId, { status, error });
  }

  const plannedByObligation: Record<string, number> = {};
  for (const c of suite.cases) {
    plannedByObligation[c.obligation] = (plannedByObligation[c.obligation] ?? 0) + 1;
  }

  return {
    runId,
    status,
    cases: saved,
    coverage: coverage({ plannedCases: suite.cases.length, cases: saved }),
    byObligation: coverageByObligation(saved, plannedByObligation),
    error,
  };
}
