import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plannedRoutes, workspaceEntitlement } from "../auth/entitlement.ts";
import { manifestForNewRun } from "../report/manifest.ts";
import { startRunExecution } from "./execute-run.ts";

/**
 * Starting a run, and advancing one — the single implementation behind the run button
 * and the API. Two copies of this became two products once already (CLAUDE.md, "when a
 * capability lands on one run path, the other is not the old path").
 *
 * Every lookup is scoped to the caller's workspace, and 0034 refuses a run that refers
 * to anything outside it regardless.
 */

export class RunRefusal extends Error {}

export async function startRun(args: {
  client: SupabaseClient;
  workspaceId: string;
  /** The person responsible: who pressed the button, or who created the key. */
  userId: string | null;
  agentId: string;
  suiteId?: string | null;
  /** Set when a pipeline started the run with a workspace API key. */
  apiKeyId?: string | null;
  /**
   * The run to compare against. Set by "rerun and compare", so the comparison answers
   * the question asked — did the change I approved fix this? — rather than comparing
   * with whatever completed last. Must be this agent's, on this suite, in this workspace.
   */
  baselineRunId?: string | null;
}): Promise<{ id: string }> {
  const { client, workspaceId, agentId } = args;

  const { data: agent } = await client
    .from("agents").select("attestation_text").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!agent) throw new RunRefusal("That agent could not be found in this workspace.");

  const { data: policy } = await client
    .from("policies").select("id").eq("agent_id", agentId).eq("workspace_id", workspaceId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new RunRefusal("Save a policy version before running the suite.");

  // A named suite is re-checked: a run must never name a suite the workspace cannot
  // read. With none named, the newest built-in version — pinning `version 1` once ran a
  // 16-scenario suite for anyone who never opened the dropdown.
  const suiteQuery = client.from("suites").select("id, workspace_id");
  const { data: suite } = args.suiteId
    ? await suiteQuery.eq("id", args.suiteId).maybeSingle()
    : await suiteQuery.is("workspace_id", null).eq("key", "eu-support")
        .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!suite) throw new RunRefusal("That suite could not be found.");
  if (suite.workspace_id !== null && suite.workspace_id !== workspaceId) {
    throw new RunRefusal("That suite does not belong to this workspace.");
  }

  let baselineId: string | null = null;
  if (args.baselineRunId) {
    const { data: chosen } = await client
      .from("runs").select("id").eq("id", args.baselineRunId).eq("workspace_id", workspaceId)
      .eq("agent_id", agentId).eq("suite_id", suite.id).maybeSingle();
    if (!chosen) throw new RunRefusal("The run to compare against is not this agent's on this suite.");
    baselineId = chosen.id as string;
  } else {
    const { data: previous } = await client
      .from("runs").select("id").eq("agent_id", agentId).eq("workspace_id", workspaceId)
      .eq("status", "completed").eq("suite_id", suite.id)
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    baselineId = (previous?.id as string | undefined) ?? null;
  }

  const entitlement = await workspaceEntitlement({ client, workspaceId });
  if (!entitlement.canRun) throw new RunRefusal(entitlement.blockedReason ?? "This workspace cannot start a run.");

  // Declared before anything runs, and frozen by the row (0016).
  const declared = await manifestForNewRun({
    client, agentId, policyId: policy.id, suiteId: suite.id,
    judgeSource: entitlement.judgeSource, routes: plannedRoutes(entitlement),
  });

  const { data: run, error } = await client
    .from("runs")
    .insert({
      id: declared.id,
      workspace_id: workspaceId, agent_id: agentId, policy_id: policy.id,
      suite_id: suite.id, baseline_run_id: baselineId, status: "queued",
      judge_source: entitlement.judgeSource, attestation_text: agent.attestation_text ?? null,
      created_by: args.userId,
      api_key_id: args.apiKeyId ?? null,
      manifest: declared.manifest, manifest_hash: declared.manifest_hash,
    })
    .select("id").single();
  if (error || !run) throw new Error(`Could not start the run: ${error?.message ?? "no row returned"}`);
  return { id: run.id as string };
}

/**
 * Vercel's Hobby ceiling is 60 s, so a run executes in bounded slices: each call grades
 * what fits, saves it, and says whether it finished. The deadline is checked before a
 * case starts, never during one.
 */
export const SLICE_BUDGET_MS = 42_000;

/**
 * How long before a run that says "running" is assumed dead. A killed function records
 * nothing, so past this another call may take the run over — which can only add
 * evidence, because stored cases are skipped.
 */
const LEASE_MS = 70_000;

export interface AdvanceResult {
  status: string;
  started: boolean;
  /** False means "call again", not "something went wrong". */
  done: boolean;
  graded?: number;
  passed?: number;
  failed?: number;
  errored?: number;
  error?: string;
}

/** One slice of a run. `null` when the run is not in this workspace. */
export async function advanceRun(args: { client: SupabaseClient; workspaceId: string; runId: string }): Promise<AdvanceResult | null> {
  const { client, workspaceId, runId } = args;
  const { data: run } = await client
    .from("runs").select("id, status, started_at").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (!run) return null;

  if (run.status === "completed" || run.status === "aborted") return { status: run.status as string, started: false, done: true };
  if (run.status === "running") {
    const age = run.started_at ? Date.now() - new Date(run.started_at as string).getTime() : Infinity;
    if (age < LEASE_MS) return { status: "running", started: false, done: false };
  }

  // Take the lease before doing any work, so a second caller a moment later sees it.
  await client.from("runs").update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", runId).eq("workspace_id", workspaceId);

  try {
    const summary = await startRunExecution({ client, workspaceId, runId, budgetMs: SLICE_BUDGET_MS });
    return {
      status: summary.status,
      started: true,
      done: summary.status !== "incomplete",
      graded: summary.cases.length,
      passed: summary.coverage.passed,
      failed: summary.coverage.failed,
      errored: summary.coverage.errored,
    };
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    await client.from("runs").update({ status: "aborted", error: message, finished_at: new Date().toISOString() })
      .eq("id", runId).eq("workspace_id", workspaceId);
    return { status: "aborted", started: true, done: true, error: message };
  }
}
