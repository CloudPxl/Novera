import "server-only";
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { startRun } from "../workflow/start-run.ts";
import { abortUnfinishedRun } from "../workflow/abort-run.ts";
import { comparableRuns, loadComparison } from "../evidence/comparison-loader.ts";
import type { CiInput } from "../report/ci.ts";
import {
  dedupeDecision, supersededReason, supersededRunIds, suiteRefCandidates, type TriggerRequest,
} from "./trigger.ts";
import { baselineComparison, ciRunExit, previousComparable, type BaselineComparison, type CiExit } from "./gate.ts";

/**
 * The database side of `POST /api/v1/ci/trigger` and `GET /api/v1/ci/runs/<id>`. Every query
 * names the caller's workspace: these run with the service role, so the key, not row-level
 * security, is what keeps workspaces apart here — and 0034/0070 refuse a cross-workspace row
 * regardless.
 */

type Db = SupabaseClient;

const WAIT_MS = 500;
const ATTEMPTS = 20;

/** A suite named by key (`eu-support-v5` or `eu-support`): the workspace's own first, then built-in. Null when none matches. */
export async function resolveSuiteRef(db: Db, workspaceId: string, ref: string): Promise<string | null> {
  for (const candidate of suiteRefCandidates(ref)) {
    let query = db.from("suites").select("id, workspace_id, version")
      .eq("key", candidate.key)
      .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
      .neq("approval", "exploratory");
    if (candidate.version !== null) query = query.eq("version", candidate.version);
    const { data } = await query.order("version", { ascending: false }).limit(20);
    const rows = (data ?? []) as Array<{ id: string; workspace_id: string | null }>;
    const own = rows.find((r) => r.workspace_id === workspaceId) ?? rows.find((r) => r.workspace_id === null);
    if (own) return own.id;
  }
  return null;
}

/** The newest built-in eu-support — what `startRun` runs when no suite is named — so a commit's row names the suite it ran. */
async function defaultSuiteId(db: Db): Promise<string | null> {
  const { data } = await db.from("suites").select("id").is("workspace_id", null).eq("key", "eu-support")
    .order("version", { ascending: false }).limit(1).maybeSingle();
  return (data?.id as string | undefined) ?? null;
}

export type TriggerOutcome =
  | { kind: "started"; runId: string; superseded: string[] }
  | { kind: "deduplicated"; runId: string; status: string }
  | { kind: "in_progress" }
  | { kind: "not_found"; error: string };

export async function triggerCiRun(args: {
  db: Db;
  workspaceId: string;
  keyId: string;
  request: TriggerRequest;
}): Promise<TriggerOutcome> {
  const { db, workspaceId, keyId, request } = args;

  // The suite is resolved before anything is claimed: a commit's row names the suite version
  // it ran, which is what "the same commit on the same suite" means.
  let suiteId = request.suiteId;
  if (request.suiteRef) {
    suiteId = await resolveSuiteRef(db, workspaceId, request.suiteRef);
    if (!suiteId) return { kind: "not_found", error: `No suite \`${request.suiteRef}\` is available to this workspace. GET /api/v1/suites lists them.` };
  }
  suiteId ??= await defaultSuiteId(db);
  if (!suiteId) return { kind: "not_found", error: "That suite could not be found." };
  if (request.includeExtensions) {
    // The workspace's newest extension of this official suite (0071): its base scenarios are
    // the official ones byte for byte, plus at most five the workspace approved.
    const { data: ext } = await db.from("suites").select("id").eq("workspace_id", workspaceId).eq("extends_suite_id", suiteId)
      .order("version", { ascending: false }).limit(1).maybeSingle();
    if (!ext) return { kind: "not_found", error: "This workspace has no extension of that suite. Publish one from Scenarios → Drafts, or leave out `include_extensions`." };
    suiteId = ext.id as string;
  }

  // The agent is read here only to name it in a 404; startRun checks it again, with everything else.
  const { data: agent } = await db.from("agents").select("id").eq("id", request.agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!agent) return { kind: "not_found", error: "No such agent in this workspace. GET /api/v1/agents lists them." };

  // The person responsible for a pipeline's run is whoever created the key it used.
  const { data: key } = await db.from("api_keys").select("created_by").eq("id", keyId).single();
  const actor = (key?.created_by as string | null) ?? null;

  const row = {
    workspace_id: workspaceId,
    agent_id: request.agentId,
    suite_id: suiteId,
    git_commit_sha: request.gitCommitSha,
    git_branch: request.gitBranch,
    pr_number: request.prNumber,
    locale: request.locale,
    api_key_id: keyId,
  };

  // Claimed before the run exists, with the id the run will have (0070), so of any number of
  // requests for one commit exactly one starts a run and the rest find it.
  let runId: string | null = null;
  for (let i = 0; i < ATTEMPTS && runId === null; i++) {
    const candidate = randomUUID();
    const { error } = await db.from("ci_triggers").insert({ ...row, run_id: candidate });
    if (!error) {
      runId = candidate;
      break;
    }
    if (error.code !== "23505" || !request.gitCommitSha) throw new Error(`The trigger could not be recorded: ${error.message}`);

    const { data: existing } = await db.from("ci_triggers").select("id, run_id, created_at")
      .eq("workspace_id", workspaceId).eq("agent_id", request.agentId).eq("suite_id", suiteId)
      .eq("locale", request.locale).eq("git_commit_sha", request.gitCommitSha).is("retired_at", null).maybeSingle();
    if (!existing) continue; // retired or removed in the meantime: claim it now
    const { data: run } = await db.from("runs").select("status").eq("id", existing.run_id).eq("workspace_id", workspaceId).maybeSingle();
    const decision = dedupeDecision({ runStatus: (run?.status as string | undefined) ?? null, claimedAt: existing.created_at as string });

    if (decision === "replay") return { kind: "deduplicated", runId: existing.run_id as string, status: run!.status as string };
    if (decision === "retire_and_retry") {
      // Conditional, so of two requests retiring the same row one does and the other finds the new claim.
      await db.from("ci_triggers").update({ retired_at: new Date().toISOString() }).eq("id", existing.id).is("retired_at", null);
      continue;
    }
    if (decision === "abandoned") {
      await db.from("ci_triggers").delete().eq("id", existing.id).eq("run_id", existing.run_id);
      continue;
    }
    await new Promise((r) => setTimeout(r, WAIT_MS));
  }
  if (runId === null) return { kind: "in_progress" };

  try {
    await startRun({
      client: db, workspaceId, userId: actor, agentId: request.agentId, suiteId,
      apiKeyId: keyId, customerDeclared: request.declared, runId, locale: request.locale,
    });
  } catch (e) {
    // A refused start leaves no claim, so the same commit can be sent again once the reason is gone.
    await db.from("ci_triggers").delete().eq("workspace_id", workspaceId).eq("run_id", runId);
    throw e;
  }

  const superseded = request.cancelSuperseded && request.gitBranch
    ? await supersede(db, workspaceId, actor, { runId, agentId: request.agentId, gitBranch: request.gitBranch, gitCommitSha: request.gitCommitSha })
    : [];
  return { kind: "started", runId, superseded };
}

/** Stops the unfinished runs earlier commits on this branch started; returns the ones this call stopped. */
async function supersede(
  db: Db, workspaceId: string, actor: string | null,
  current: { runId: string; agentId: string; gitBranch: string; gitCommitSha: string | null },
): Promise<string[]> {
  const { data: triggers } = await db.from("ci_triggers").select("run_id, agent_id, git_branch, git_commit_sha")
    .eq("workspace_id", workspaceId).eq("agent_id", current.agentId).eq("git_branch", current.gitBranch)
    .neq("run_id", current.runId).order("created_at", { ascending: false }).limit(50);
  const list = ((triggers ?? []) as Array<Record<string, unknown>>).map((t) => ({
    runId: t.run_id as string, agentId: t.agent_id as string,
    gitBranch: (t.git_branch as string | null) ?? null, gitCommitSha: (t.git_commit_sha as string | null) ?? null,
  }));
  if (list.length === 0) return [];
  const { data: runs } = await db.from("runs").select("id, status").eq("workspace_id", workspaceId).in("id", list.map((t) => t.runId));
  const status = new Map(((runs ?? []) as Array<{ id: string; status: string }>).map((r) => [r.id, r.status]));

  const stopped: string[] = [];
  for (const id of supersededRunIds(current, list, status)) {
    const result = await abortUnfinishedRun({
      client: db, workspaceId, runId: id, stoppedBy: actor,
      reason: supersededReason({ gitCommitSha: current.gitCommitSha, gitBranch: current.gitBranch, runId: current.runId }),
    });
    if (result.stopped) stopped.push(id);
  }
  return stopped;
}

export interface CiRunStatus {
  run: {
    id: string;
    status: string;
    agent_id: string;
    suite: string | null;
    created_at: string;
    finished_at: string | null;
    git_commit_sha: string | null;
    git_branch: string | null;
    pr_number: number | null;
  };
  exit: CiExit;
  report: { content_hash: string; token: string; payload: unknown } | null;
  suite_digest: string | null;
  baseline_comparison: BaselineComparison | null;
}

/** One run as a CI gate reads it. Null when it is not a run in this workspace. */
export async function loadCiRun(db: Db, workspaceId: string, runId: string, origin: string): Promise<CiRunStatus | null> {
  const { data: run } = await db.from("runs")
    .select("id, status, error, agent_id, suite_id, created_at, finished_at, manifest, suites(key, version, workspace_id)")
    .eq("workspace_id", workspaceId).eq("id", runId).maybeSingle();
  if (!run) return null;

  const [{ data: report }, { data: trigger }] = await Promise.all([
    db.from("reports").select("content_hash, token, payload, revoked_at")
      .eq("workspace_id", workspaceId).eq("run_id", runId).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("ci_triggers").select("git_commit_sha, git_branch, pr_number").eq("workspace_id", workspaceId).eq("run_id", runId).maybeSingle(),
  ]);

  const status = run.status as string;
  const exit = ciRunExit({
    status,
    error: (run.error as string | null) ?? null,
    report: report ? { payload: (report.payload as CiInput | null) ?? null, revoked: Boolean(report.revoked_at) } : null,
  });

  const suite = run.suites as unknown as { key: string; version: number; workspace_id: string | null } | null;
  const manifest = run.manifest as { suite_digest?: unknown } | null;

  let baseline: BaselineComparison | null = null;
  if (status === "completed" && suite) {
    const candidates = await comparableRuns(db, { id: runId, agentId: run.agent_id as string }, { key: suite.key, owner: suite.workspace_id });
    const base = previousComparable(candidates, { id: runId, createdAt: run.created_at as string });
    if (base) {
      const loaded = await loadComparison({ db, workspaceId, baseId: base.id, targetId: runId });
      if (loaded.ok) baseline = baselineComparison(loaded.deltas, base.id, runId, origin);
    }
  }

  return {
    run: {
      id: run.id as string,
      status,
      agent_id: run.agent_id as string,
      suite: suite ? `${suite.key} v${suite.version}` : null,
      created_at: run.created_at as string,
      finished_at: (run.finished_at as string | null) ?? null,
      git_commit_sha: (trigger?.git_commit_sha as string | null | undefined) ?? null,
      git_branch: (trigger?.git_branch as string | null | undefined) ?? null,
      pr_number: (trigger?.pr_number as number | null | undefined) ?? null,
    },
    exit,
    // A withdrawn report is not handed out: its link refuses at once (0053).
    report: report && !report.revoked_at
      ? { content_hash: report.content_hash as string, token: report.token as string, payload: report.payload }
      : null,
    suite_digest: typeof manifest?.suite_digest === "string" ? manifest.suite_digest : null,
    baseline_comparison: baseline,
  };
}
