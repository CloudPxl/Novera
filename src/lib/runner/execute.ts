import type { AgentAdapter } from "../agents/types.ts";
import type { Provider } from "../providers/types.ts";
import { judgeCase } from "../judge/index.ts";
import { coverage, coverageByObligation, type Coverage, type ObligationCoverage } from "../evidence/coverage.ts";
import type { RunCaseRecord, RunStore, Suite } from "./types.ts";

export interface ExecuteRunArgs {
  runId: string;
  suite: Suite;
  agent: AgentAdapter;
  /** The approved policy text for this run; a run always names its policy version. */
  policy: string;
  judge: { provider: Provider; apiKey: string; model: string };
  store: RunStore;
  /** Kept low by default: customer endpoints and free judge tiers both rate-limit. */
  concurrency?: number;
}

export interface RunSummary {
  runId: string;
  status: "completed" | "aborted";
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
  const { runId, suite, agent, policy, judge, store, concurrency = 3 } = args;

  await store.markRunning(runId);

  const records = new Array<RunCaseRecord>(suite.cases.length);
  let cursor = 0;

  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= suite.cases.length) return;
      const testCase = suite.cases[index];

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
          error: agentResult.error ?? "The agent produced no response.",
        };
        await store.saveCase(records[index]);
        continue;
      }

      const verdict = await judgeCase({
        provider: judge.provider,
        apiKey: judge.apiKey,
        model: judge.model,
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
          judgeModel: verdict.judgeModel,
        },
        error: verdict.error,
      };
      await store.saveCase(records[index]);
    }
  }

  let status: "completed" | "aborted" = "completed";
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
  await store.finishRun(runId, { status, error });

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
