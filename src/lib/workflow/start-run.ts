import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { plannedRoutes, TRIAL_EXHAUSTED, workspaceEntitlement } from "../auth/entitlement.ts";
import { manifestForNewRun } from "../report/manifest.ts";
import { startRunExecution } from "./execute-run.ts";
import { notifyRunFinished } from "../webhooks/deliver.ts";
import { track } from "../analytics/track.ts";

/**
 * Starting a run, and advancing one — the single implementation behind the run button
 * and the API. Two copies of this became two products once already (CLAUDE.md, "when a
 * capability lands on one run path, the other is not the old path").
 *
 * Every lookup is scoped to the caller's workspace, and 0034 refuses a run that refers
 * to anything outside it regardless.
 */

export class RunRefusal extends Error {}

export const ARCHIVED_AGENT = "This agent is archived, so no new run can start for it. Its runs and reports are kept; an owner or admin can restore it from its Connection tab.";

export async function startRun(args: {
  client: SupabaseClient;
  workspaceId: string;
  /** The person responsible: who pressed the button, created the key or set the schedule. */
  userId: string | null;
  agentId: string;
  suiteId?: string | null;
  /** Set when a pipeline started the run with a workspace API key. */
  apiKeyId?: string | null;
  /** Set when a schedule started the run. */
  scheduleId?: string | null;
  /**
   * What the person says they are testing — a release, a knowledge-base revision. Not
   * `declared`: in this function that word already means the manifest.
   */
  customerDeclared?: { releaseId?: string; knowledgeBaseRevision?: string };
  /**
   * The run to compare against. Set by "rerun and compare", so the comparison answers
   * the question asked — did the change I approved fix this? — rather than comparing
   * with whatever completed last. Must be this agent's, on this suite, in this workspace.
   */
  baselineRunId?: string | null;
  /** The id to create the run with, chosen first by an Idempotency-Key claim. */
  runId?: string;
  /**
   * Set only by the Suite Builder's scan. A suite marked exploratory is refused from every
   * other entry point — the button, the API, MCP, a schedule — so a scan is always started
   * on purpose, and the database refuses it a report (0056).
   */
  exploratory?: boolean;
}): Promise<{ id: string }> {
  const { client, workspaceId, agentId } = args;

  const { data: agent } = await client
    .from("agents").select("attestation_text, archived_at").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!agent) throw new RunRefusal("That agent could not be found in this workspace.");
  // Every entry point — the button, rerun, the API, MCP, a schedule, a Builder scan — comes
  // through here, and 0063 refuses the row regardless.
  if (agent.archived_at) throw new RunRefusal(ARCHIVED_AGENT);

  const { data: policy } = await client
    .from("policies").select("id").eq("agent_id", agentId).eq("workspace_id", workspaceId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) throw new RunRefusal("Save a policy version before running the suite.");

  // A named suite is re-checked: a run must never name a suite the workspace cannot
  // read. With none named, the newest built-in version — pinning `version 1` once ran a
  // 16-scenario suite for anyone who never opened the dropdown.
  const suiteQuery = client.from("suites").select("id, workspace_id, approval");
  const { data: suite } = args.suiteId
    ? await suiteQuery.eq("id", args.suiteId).maybeSingle()
    : await suiteQuery.is("workspace_id", null).eq("key", "eu-support")
        .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!suite) throw new RunRefusal("That suite could not be found.");
  if (suite.workspace_id !== null && suite.workspace_id !== workspaceId) {
    throw new RunRefusal("That suite does not belong to this workspace.");
  }
  if ((suite.approval === "exploratory") !== Boolean(args.exploratory)) {
    throw new RunRefusal(suite.approval === "exploratory"
      ? "That suite is an exploratory scan of unapproved drafts. Start scans from the Suite Builder; publish the suite to run it here."
      : "An exploratory scan runs only a Suite Builder scan suite.");
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
    declared: args.customerDeclared,
    runId: args.runId,
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
      schedule_id: args.scheduleId ?? null,
      manifest: declared.manifest, manifest_hash: declared.manifest_hash,
    })
    .select("id").single();
  // The database counts the trial under a lock (0049): of several starts at once, the ones
  // past the third are refused here even though each passed the check above.
  if (error && /trial_exhausted/.test(error.message)) throw new RunRefusal(TRIAL_EXHAUSTED);
  // Archived between the check above and the insert: the database decided (0063).
  if (error && /agent_archived/.test(error.message)) throw new RunRefusal(ARCHIVED_AGENT);
  if (error || !run) throw new Error(`Could not start the run: ${error?.message ?? "no row returned"}`);
  await track("run_created", {
    workspaceId, userId: args.userId,
    properties: {
      source: args.exploratory ? "builder_scan" : args.scheduleId ? "schedule" : args.apiKeyId ? "api" : args.baselineRunId ? "rerun" : "button",
      judge_source: entitlement.judgeSource,
    },
  });
  return { id: run.id as string };
}

/**
 * Vercel's Hobby ceiling is 60 s, so a run executes in bounded slices: each call grades
 * what fits, saves it, and says whether it finished. The deadline is checked before a
 * case starts, never during one.
 */
export const SLICE_BUDGET_MS = 42_000;

/**
 * How long a slice holds a run. A killed function records nothing, so past this another
 * call may take the run over — which can only add evidence, because stored cases are
 * skipped. A slice that hands back releases it at once (0036).
 */
const LEASE_MS = 70_000;

/**
 * How many slices may grade on Novera's shared trial keys at once. Measured: at four
 * concurrent runs the free Groq tier ran out and one scenario in eight got no verdict
 * (DECISIONS.md, 2026-09-29). A run beyond this waits its turn; its slice is not
 * started and the caller calls again, as it would for any held lease.
 */
export const TRIAL_GRADING_SLOTS = 2;

export interface AdvanceResult {
  status: string;
  started: boolean;
  /** False means "call again", not "something went wrong". */
  done: boolean;
  /** Set when the slice did not start because the shared grading slots are all busy. */
  waiting?: "grading_capacity";
  graded?: number;
  passed?: number;
  failed?: number;
  errored?: number;
  error?: string;
}

/**
 * One slice of a run. `null` when the run is not in this workspace.
 *
 * `budgetMs` lets a caller with less than a full slice left — the scheduler, driving
 * several runs in one invocation — hand back in time. Never more than a slice.
 */
export async function advanceRun(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  budgetMs?: number;
}): Promise<AdvanceResult | null> {
  const { client, workspaceId, runId } = args;
  const budgetMs = Math.min(args.budgetMs ?? SLICE_BUDGET_MS, SLICE_BUDGET_MS);
  const { data: run } = await client
    .from("runs").select("id, status").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (!run) return null;

  if (run.status === "completed" || run.status === "aborted") return { status: run.status as string, started: false, done: true };

  // Take the lease in one statement, so of two callers at the same moment exactly one
  // gets it — and, for a run on the shared trial keys, only while a grading slot is
  // free (0041). Reading the lease and then writing it let both through. The claim names
  // this slice with a token (0047); every write the slice makes carries it, so a slice
  // that outlived its lease can no longer send, save, release or abort.
  const now = new Date();
  const { data: claimed, error: claimError } = await client.rpc("claim_run_slice_fenced", {
    target: runId, ws: workspaceId, lease_ms: LEASE_MS, trial_slots: TRIAL_GRADING_SLOTS,
  });
  if (claimError) throw new Error(`Could not claim the run: ${claimError.message}`);
  const claim = (claimed as { outcome?: string } | null)?.outcome;
  const leaseToken = (claimed as { lease_token?: string } | null)?.lease_token;
  if (claim !== "claimed" || !leaseToken) {
    const { data: after } = await client.from("runs").select("status").eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
    const status = (after?.status as string | undefined) ?? "running";
    return {
      status, started: false, done: status === "completed" || status === "aborted",
      ...(claim === "busy" ? { waiting: "grading_capacity" as const } : {}),
    };
  }

  // The run's start, written once and before the slice reads it: the report's duration
  // is measured from here. Stamped inside the runner instead, the first slice read null
  // and a run that finished in one slice sealed a report with no duration.
  await client.from("runs").update({ started_at: now.toISOString() })
    .eq("id", runId).eq("workspace_id", workspaceId).is("started_at", null);

  try {
    const summary = await startRunExecution({ client, workspaceId, runId, budgetMs, leaseToken });
    // Handing back: the next slice may start now rather than when the lease runs out —
    // this slice's lease only, never one another slice has since taken.
    await client.from("runs").update({ lease_until: null, lease_token: null })
      .eq("id", runId).eq("workspace_id", workspaceId).eq("lease_token", leaseToken);
    if (summary.status !== "incomplete") {
      // Finished (or stopped): tell the workspace's webhooks, briefly, within this call.
      await notifyRunFinished(client, workspaceId, runId, Date.now() + 8_000);
    }
    if (summary.status === "completed") await track("run_completed", { workspaceId, properties: { cases: summary.coverage.planned } });
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
    if (await abortHeldRun(client, workspaceId, runId, leaseToken, message)) {
      return { status: "aborted", started: true, done: true, error: message };
    }
    // This slice no longer held the run: its failure is not the run's. The slice that
    // took it over carries on, so the caller just calls again.
    return { status: "running", started: true, done: false, error: message };
  }
}

/**
 * Ends a run because the slice holding it failed outside any one scenario. Only that
 * slice can: true when it still held the lease and the run was ended, false when another
 * slice had taken it over (or it was already over) and nothing changed.
 */
export async function abortHeldRun(client: SupabaseClient, workspaceId: string, runId: string, leaseToken: string, message: string): Promise<boolean> {
  const { data } = await client.from("runs")
    .update({ status: "aborted", error: message, finished_at: new Date().toISOString(), lease_until: null, lease_token: null })
    .eq("id", runId).eq("workspace_id", workspaceId).eq("lease_token", leaseToken)
    .in("status", ["queued", "running"]).select("id");
  return (data ?? []).length === 1;
}
