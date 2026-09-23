import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { executeRun, type RunSummary } from "../runner/execute.ts";
import type { RunCaseRecord } from "../runner/types.ts";
import { coverage, coverageByObligation, coverageByCategory } from "../evidence/coverage.ts";
import type { Suite } from "../runner/types.ts";
import { supabaseRunStore } from "../store/supabase-run-store.ts";
import { createRoutedChat } from "../router/execute.ts";
import { DEFAULT_ROUTES } from "../router/routes.ts";
import { connectionsForWorkspace } from "../providers/workspace-connections.ts";
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
  /** How long this invocation may spend before handing back a resumable result. */
  budgetMs?: number;
}): Promise<RunSummary> {
  const { client, workspaceId, runId, budgetMs } = args;
  const deadline = budgetMs === undefined ? undefined : Date.now() + budgetMs;

  // Separate reads rather than one embedded select: without generated database
  // types the embedded form is untyped, and this is easier to follow anyway.
  const { data: run, error } = await client
    .from("runs")
    .select("id, agent_id, policy_id, suite_id, baseline_run_id, judge_source, attestation_text, pass_threshold, started_at")
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

  // A workspace with its own key grades on that key alone. The run row already
  // recorded which of the two funded it, at the moment it was created.
  const { connections } = await connectionsForWorkspace({ client, workspaceId });
  const judge = createRoutedChat({ connections, routes: DEFAULT_ROUTES });

  // What an earlier attempt already graded. Cases are never re-sent to the agent:
  // a second verdict over the same scenario would be new evidence replacing old.
  const { data: existing } = await client
    .from("run_cases").select("case_id").eq("run_id", runId);

  const summary = await executeRun({
    runId,
    suite,
    agent: adapter,
    policy: policy.body,
    judge,
    store: supabaseRunStore(client, workspaceId),
    skipCaseIds: (existing ?? []).map((c) => c.case_id as string),
    deadline,
  });

  // Out of time, not out of luck: the caller invokes this again and it picks up.
  if (summary.status === "incomplete") return summary;

  // Rebuilt from stored rows rather than from this invocation's memory: after a
  // resume, memory holds only the cases this attempt happened to grade.
  const whole = await summaryFromStoredRows({ client, runId, suite, status: summary.status, error: summary.error });

  // A run with no gradable result is not worth a report; leave it as evidence of the
  // attempt rather than publishing an empty document.
  if (whole.coverage.graded === 0) return whole;

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

  // Measured from the run's own timestamps, so a resumed run reports the wall time
  // the customer actually waited rather than the last slice's duration.
  const startedAt = run.started_at ? new Date(run.started_at as string).getTime() : null;
  const durationMs = startedAt === null ? null : Date.now() - startedAt;

  await publishReport({
    client, workspaceId, runId, summary: whole,
    passThreshold: (run.pass_threshold as number | null) ?? 80,
    durationMs,
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

  return whole;
}

/**
 * The run as the database holds it.
 *
 * Every figure in a report has to come from stored rows — that is a product rule, and
 * once a run can be executed across more than one invocation it is also the only way
 * to get the right answer.
 */
async function summaryFromStoredRows(args: {
  client: SupabaseClient;
  runId: string;
  suite: Suite;
  status: RunSummary["status"];
  error?: string;
}): Promise<RunSummary> {
  const { client, runId, suite, status, error } = args;

  const { data: rows } = await client
    .from("run_cases")
    .select("case_id, category, obligation, severity, input, expected, assertions, response_text, tool_activity, status, rationale, latency_ms, usage, judge_model, judge_attempts, judge_votes, judge_agreement, failed_assertions, evidence_gap, settled_by, error")
    .eq("run_id", runId)
    .order("case_id");

  const cases: RunCaseRecord[] = (rows ?? []).map((r) => ({
    runId,
    caseId: r.case_id as string,
    category: r.category as string,
    obligation: r.obligation as string,
    severity: r.severity as string,
    input: r.input as string,
    expected: r.expected as string,
    assertions: Array.isArray(r.assertions) ? (r.assertions as string[]) : [],
    responseText: (r.response_text as string | null) ?? null,
    toolActivity: r.tool_activity ?? null,
    status: r.status as RunCaseRecord["status"],
    rationale: (r.rationale as string | null) ?? null,
    latencyMs: (r.latency_ms as number | null) ?? 0,
    usage: r.usage ?? null,
    judgeModel: (r.judge_model as string | null) ?? null,
    judgeAttempts: Array.isArray(r.judge_attempts) ? (r.judge_attempts as unknown[]) : [],
    judgeVotes: Array.isArray(r.judge_votes) ? (r.judge_votes as unknown[]) : [],
    judgeAgreement: (r.judge_agreement as string | null) ?? null,
    failedAssertions: Array.isArray(r.failed_assertions) ? (r.failed_assertions as string[]) : [],
    evidenceGap: (r.evidence_gap as RunCaseRecord["evidenceGap"]) ?? null,
    settledBy: (r.settled_by as RunCaseRecord["settledBy"]) ?? null,
    error: (r.error as string | null) ?? null,
  }));

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
    cases,
    coverage: coverage({
      plannedCases: suite.cases.length,
      // Mapped, not spread: the record calls it `judgeAgreement` and coverage calls
      // it `agreement`, and a silent name mismatch here would zero the disputed
      // count without failing anything. The assertion counts are named differently
      // again, because a record's `assertions` is the strings and coverage wants how
      // many of them there are.
      cases: cases.map((c) => ({
        status: c.status,
        agreement: c.judgeAgreement,
        evidenceGap: c.evidenceGap,
        assertionCount: c.assertions.length,
        failedAssertionCount: c.failedAssertions.length,
        requiresEvidence: requiresEvidence.has(c.caseId),
        settledBy: c.settledBy,
      })),
    }),
    byObligation: coverageByObligation(cases, plannedByObligation),
    byCategory: coverageByCategory(cases, plannedByCategory),
    error,
  };
}
