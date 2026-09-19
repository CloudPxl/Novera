import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { executeRun, type RunSummary } from "../runner/execute.ts";
import type { Suite } from "../runner/types.ts";
import { supabaseRunStore } from "../store/supabase-run-store.ts";
import { createRoutedChat } from "../router/execute.ts";
import { DEFAULT_ROUTES } from "../router/routes.ts";
import { connectionsFromEnv } from "../providers/registry.ts";
import { publishReport } from "./run.ts";

/**
 * Loads everything a queued run refers to and executes it, then publishes a report.
 *
 * The run row already names its agent, policy version and suite, so this reads the
 * run rather than taking those as arguments: what gets executed is whatever the run
 * committed to when it was created, not whatever is current now.
 */
export async function startRunExecution(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
}): Promise<RunSummary> {
  const { client, workspaceId, runId } = args;

  // Separate reads rather than one embedded select: without generated database
  // types the embedded form is untyped, and this is easier to follow anyway.
  const { data: run, error } = await client
    .from("runs")
    .select("id, agent_id, policy_id, suite_id, baseline_run_id, judge_source, attestation_text")
    .eq("id", runId)
    .eq("workspace_id", workspaceId)
    .single();

  if (error || !run) throw new Error(`Run not found: ${error?.message ?? "no such run"}`);

  const [agentRow, policyRow, suiteRow, workspaceRow] = await Promise.all([
    client.from("agents").select("name, config").eq("id", run.agent_id).single(),
    client.from("policies").select("version, body").eq("id", run.policy_id).single(),
    client.from("suites").select("key, version, name, cases").eq("id", run.suite_id).single(),
    client.from("workspaces").select("name").eq("id", workspaceId).single(),
  ]);

  if (!agentRow.data || !policyRow.data || !suiteRow.data || !workspaceRow.data) {
    throw new Error("The run refers to something that no longer exists.");
  }

  const agent = agentRow.data as { name: string; config: AgentConfig };
  const policy = policyRow.data as { version: number; body: string };
  const suite = suiteRow.data as Suite;
  const workspace = workspaceRow.data as { name: string };

  const adapter = await buildAgentAdapter({
    client, workspaceId, agentId: run.agent_id, config: agent.config,
  });

  const judge = createRoutedChat({ connections: connectionsFromEnv(), routes: DEFAULT_ROUTES });

  const summary = await executeRun({
    runId,
    suite,
    agent: adapter,
    policy: policy.body,
    judge,
    store: supabaseRunStore(client, workspaceId),
  });

  // A run with no gradable result is not worth a report; leave it as evidence of the
  // attempt rather than publishing an empty document.
  if (summary.coverage.graded === 0) return summary;

  let baseline: Parameters<typeof publishReport>[0]["baseline"];
  if (run.baseline_run_id) {
    const { data: previousCases } = await client
      .from("run_cases").select("case_id, status").eq("run_id", run.baseline_run_id);
    if (previousCases?.length) {
      const { data: previousRun } = await client
        .from("runs").select("policy_id").eq("id", run.baseline_run_id).single();
      const { data: previousPolicy } = previousRun
        ? await client.from("policies").select("version").eq("id", previousRun.policy_id).single()
        : { data: null };
      baseline = {
        runId: run.baseline_run_id,
        policyVersion: previousPolicy?.version ?? 0,
        cases: previousCases.map((c) => ({ caseId: c.case_id, status: c.status })),
      };
    }
  }

  await publishReport({
    client, workspaceId, runId, summary,
    clientName: workspace.name,
    agentName: agent.name,
    policyVersion: policy.version,
    policyBody: policy.body,
    environment: "Customer-operated agent, tested with recorded authorisation",
    attestation: run.attestation_text ?? null,
    suite: { key: suite.key, version: suite.version, name: suite.name },
    judgeSource: (run.judge_source as "trial_free" | "workspace_key" | null) ?? "trial_free",
    baseline,
  });

  return summary;
}
