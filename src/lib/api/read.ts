import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What a workspace API key can read. Shared by the REST routes and the MCP server, so the
 * two cannot disagree about what a run contains.
 *
 * Every query names the caller's workspace, because these run with the service role —
 * the key, not a person's session, is the credential, so row-level security is not the
 * thing keeping workspaces apart here. `verify:api` proves that it holds.
 *
 * Counts are computed from stored case rows, never taken from anywhere else. Keys,
 * secrets and policy text are never returned; a report's link is, because a member of
 * the workspace can already see and share it.
 */

type Db = SupabaseClient;

function hostOf(config: unknown): string | null {
  try {
    return new URL(String((config as { url?: unknown })?.url ?? "")).host || null;
  } catch {
    return null;
  }
}

function tally(rows: Array<{ run_id?: unknown; status: unknown }>, runId?: string) {
  const mine = runId ? rows.filter((r) => r.run_id === runId) : rows;
  const count = (s: string) => mine.filter((r) => r.status === s).length;
  return { passed: count("pass"), failed: count("fail"), no_result: count("error") };
}

export async function listAgents(db: Db, workspaceId: string) {
  const [{ data: agents }, { data: policies }] = await Promise.all([
    db.from("agents").select("id, name, config, is_production, created_at").eq("workspace_id", workspaceId).order("created_at"),
    db.from("policies").select("agent_id, version").eq("workspace_id", workspaceId),
  ]);
  return (agents ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    host: hostOf(a.config),
    is_production: a.is_production !== false,
    policy_version: Math.max(0, ...(policies ?? []).filter((p) => p.agent_id === a.id).map((p) => p.version as number)) || null,
    created_at: a.created_at as string,
  }));
}

export async function listSuites(db: Db, workspaceId: string) {
  const { data } = await db.from("suites").select("id, key, version, name, cases, workspace_id")
    .or(`workspace_id.eq.${workspaceId},workspace_id.is.null`)
    .order("key").order("version", { ascending: false });
  return (data ?? []).map((s) => ({
    id: s.id as string,
    key: s.key as string,
    version: s.version as number,
    name: s.name as string,
    scenarios: Array.isArray(s.cases) ? s.cases.length : 0,
    built_in: s.workspace_id === null,
  }));
}

/** Who started a run: a person with the button, a pipeline with an API key, or a schedule. */
function startedBy(r: { api_key_id?: unknown; schedule_id?: unknown }): "person" | "api_key" | "schedule" {
  return r.schedule_id ? "schedule" : r.api_key_id ? "api_key" : "person";
}

export async function listRuns(db: Db, workspaceId: string, options: { agentId?: string; limit?: number } = {}) {
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  let query = db.from("runs")
    .select("id, agent_id, status, created_at, finished_at, api_key_id, schedule_id, agents(name), suites(key, version), policies(version)")
    .eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(limit);
  if (options.agentId) query = query.eq("agent_id", options.agentId);
  const { data: runs } = await query;
  const ids = (runs ?? []).map((r) => r.id as string);
  const [{ data: cases }, { data: reports }] = ids.length
    ? await Promise.all([
        db.from("run_cases").select("run_id, status").eq("workspace_id", workspaceId).in("run_id", ids),
        db.from("reports").select("run_id, token, content_hash, revoked_at").eq("workspace_id", workspaceId).in("run_id", ids),
      ])
    : [{ data: [] }, { data: [] }];
  return (runs ?? []).map((r) => {
    const report = (reports ?? []).find((x) => x.run_id === r.id && !x.revoked_at);
    const agent = r.agents as unknown as { name: string } | null;
    const suite = r.suites as unknown as { key: string; version: number } | null;
    const policy = r.policies as unknown as { version: number } | null;
    return {
      id: r.id as string,
      agent: { id: r.agent_id as string, name: agent?.name ?? null },
      suite: suite ? `${suite.key} v${suite.version}` : null,
      policy_version: policy?.version ?? null,
      status: r.status as string,
      started_by: startedBy(r),
      created_at: r.created_at as string,
      finished_at: (r.finished_at as string | null) ?? null,
      counts: tally((cases ?? []) as Array<{ run_id: unknown; status: unknown }>, r.id as string),
      report: report ? { content_hash: report.content_hash as string, token: report.token as string } : null,
    };
  });
}

/** One run and every scenario in it. `null` when it does not exist in this workspace. */
export async function getRun(db: Db, workspaceId: string, runId: string, options: { responses?: boolean } = {}) {
  const [{ data: run }, { data: cases }] = await Promise.all([
    db.from("runs").select("id, agent_id, status, created_at, finished_at, error, manifest_hash, api_key_id, schedule_id, agents(name), suites(key, version), policies(version)")
      .eq("workspace_id", workspaceId).eq("id", runId).maybeSingle(),
    db.from("run_cases")
      .select(`case_id, category, obligation, severity, status, rationale, settled_by, judge_agreement, judge_model, evidence_gap, error, failed_assertions${options.responses ? ", input, response_text, transcript" : ""}`)
      .eq("workspace_id", workspaceId).eq("run_id", runId).order("case_id"),
  ]);
  if (!run) return null;
  const { data: report } = await db.from("reports").select("token, content_hash, revoked_at, created_at")
    .eq("workspace_id", workspaceId).eq("run_id", runId).is("revoked_at", null)
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  const rows = (cases ?? []) as unknown as Array<Record<string, unknown>>;
  const agent = run.agents as unknown as { name: string } | null;
  const suite = run.suites as unknown as { key: string; version: number } | null;
  const policy = run.policies as unknown as { version: number } | null;
  return {
    id: run.id as string,
    agent: { id: run.agent_id as string, name: agent?.name ?? null },
    suite: suite ? `${suite.key} v${suite.version}` : null,
    policy_version: policy?.version ?? null,
    status: run.status as string,
    started_by: startedBy(run),
    error: (run.error as string | null) ?? null,
    created_at: run.created_at as string,
    finished_at: (run.finished_at as string | null) ?? null,
    manifest_hash: (run.manifest_hash as string | null) ?? null,
    counts: tally(rows as Array<{ status: unknown }>),
    report: report ? { content_hash: report.content_hash as string, token: report.token as string } : null,
    cases: rows.map((c) => ({
      id: c.case_id as string,
      category: c.category as string,
      obligation: c.obligation as string,
      severity: c.severity as string,
      verdict: c.status === "error" ? "no_result" : (c.status as string),
      rationale: (c.rationale as string | null) ?? null,
      error: (c.error as string | null) ?? null,
      settled_by: (c.settled_by as string | null) ?? null,
      agreement: (c.judge_agreement as string | null) ?? null,
      graded_by: (c.judge_model as string | null) ?? null,
      evidence_gap: (c.evidence_gap as string | null) ?? null,
      failed_assertions: Array.isArray(c.failed_assertions) ? (c.failed_assertions as string[]) : [],
      ...(options.responses
        ? { input: c.input as string, response: (c.response_text as string | null) ?? null, transcript: c.transcript ?? null }
        : {}),
    })),
  };
}
