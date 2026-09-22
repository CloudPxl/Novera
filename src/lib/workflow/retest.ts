import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { executeCase } from "../runner/execute.ts";
import type { Suite, SuiteCase } from "../runner/types.ts";
import { createRoutedChat } from "../router/execute.ts";
import { DEFAULT_ROUTES } from "../router/routes.ts";
import { connectionsForWorkspace } from "../providers/workspace-connections.ts";

export interface RetestResult {
  id: string;
  status: "pass" | "fail" | "error";
  policyVersion: number;
}

/**
 * Re-running one scenario against the policy as it stands now.
 *
 * This answers "did my fix work?" in seconds instead of a full suite. What it is
 * emphatically not is a run: it is stored in `case_retests`, never in `runs`, so it
 * cannot reach a score, a coverage figure, a baseline comparison or a report. A
 * report is always a whole suite against one policy version, and a one-case "run"
 * would quietly corrupt every one of those.
 *
 * It grades through `executeCase`, the same function a suite run uses, so a retest
 * and the run that follows it cannot reach different verdicts by different routes.
 */
export async function retestCase(args: {
  client: SupabaseClient;
  workspaceId: string;
  runCaseId: string;
  userId: string;
}): Promise<RetestResult> {
  const { client, workspaceId, runCaseId, userId } = args;

  const { data: runCase } = await client
    .from("run_cases")
    .select("id, run_id, case_id, category, obligation, severity, input, expected, assertions")
    .eq("id", runCaseId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();
  if (!runCase) throw new Error("That scenario could not be found.");

  const { data: run } = await client
    .from("runs").select("agent_id, suite_id").eq("id", runCase.run_id).maybeSingle();
  if (!run) throw new Error("The run this scenario belongs to no longer exists.");

  // Deliberately the newest policy, not the one the original case was graded under.
  // Retesting against the old version would answer a question nobody asked.
  const { data: policy } = await client
    .from("policies").select("id, version, body").eq("agent_id", run.agent_id)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new Error("This agent has no policy version to test against.");

  const { data: agentRow } = await client
    .from("agents").select("config").eq("id", run.agent_id).maybeSingle();
  if (!agentRow) throw new Error("The agent this scenario was run against no longer exists.");

  // `forbidden` and `effect` live only in the suite — run_cases never stored either —
  // and the judge needs them to grade the same way it did the first time. Without
  // them the retest would be a slightly easier test than the run, which is the one
  // thing it must not be: a retest exists to predict the run.
  const { data: suiteRow } = await client
    .from("suites").select("cases").eq("id", run.suite_id).maybeSingle();
  const suiteCases = Array.isArray(suiteRow?.cases) ? (suiteRow.cases as Suite["cases"]) : [];
  const fromSuite = suiteCases.find((c) => c.id === runCase.case_id);

  const testCase: SuiteCase = {
    id: runCase.case_id as string,
    category: runCase.category as string,
    obligation: runCase.obligation as string,
    severity: runCase.severity as string,
    input: runCase.input as string,
    expected_behavior: runCase.expected as string,
    assertions: Array.isArray(runCase.assertions) ? (runCase.assertions as string[]) : [],
    forbidden: fromSuite?.forbidden,
    effect: fromSuite?.effect,
  };

  const adapter = await buildAgentAdapter({
    client, workspaceId, agentId: run.agent_id as string, config: agentRow.config as AgentConfig,
  });
  const { connections } = await connectionsForWorkspace({ client, workspaceId });
  const judge = createRoutedChat({ connections, routes: DEFAULT_ROUTES });

  const outcome = await executeCase({ testCase, agent: adapter, policy: policy.body as string, judge });

  const { data: stored, error } = await client
    .from("case_retests")
    .insert({
      workspace_id: workspaceId,
      run_case_id: runCaseId,
      policy_id: policy.id,
      response_text: outcome.responseText,
      status: outcome.status,
      rationale: outcome.rationale,
      failed_assertions: outcome.failedAssertions,
      evidence_gap: outcome.evidenceGap,
      judge_model: outcome.judgeModel,
      judge_votes: outcome.judgeVotes,
      judge_agreement: outcome.judgeAgreement,
      latency_ms: outcome.latencyMs,
      error: outcome.error,
      created_by: userId,
    })
    .select("id").single();

  if (error) throw new Error(`The retest ran but could not be recorded: ${error.message}`);

  return {
    id: stored.id as string,
    status: outcome.status,
    policyVersion: policy.version as number,
  };
}
