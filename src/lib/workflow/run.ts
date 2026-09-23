import "server-only";
import { randomBytes } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { manifestForNewRun } from "../report/manifest.ts";
import type { AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { buildVerifier } from "../evidence/connectors/index.ts";
import { executeRun, type RunSummary } from "../runner/execute.ts";
import type { Suite } from "../runner/types.ts";
import { supabaseRunStore } from "../store/supabase-run-store.ts";
import { createRoutedChat } from "../router/execute.ts";
import { DEFAULT_ROUTES } from "../router/routes.ts";
import { connectionsFromEnv } from "../providers/registry.ts";
import { buildReport } from "../report/build.ts";
import { PROBE_INPUT } from "../agents/types.ts";

/**
 * The product's spine: probe, run, report.
 *
 * Each step persists before the next begins, so a failure halfway leaves real
 * evidence of what did happen rather than nothing at all.
 */

/** One harmless request, saved before any suite is trusted. */
export async function probeAgent(args: {
  client: SupabaseClient;
  workspaceId: string;
  agentId: string;
  config: AgentConfig;
}): Promise<{ ok: boolean; probeId: string; error: string | null }> {
  const { client, workspaceId, agentId, config } = args;
  const adapter = await buildAgentAdapter({ client, workspaceId, agentId, config });
  const result = await adapter.probe();

  const { data, error } = await client
    .from("probes")
    .insert({
      workspace_id: workspaceId,
      agent_id: agentId,
      request: { input: PROBE_INPUT },
      status_code: result.statusCode ?? null,
      response_body: result.responseText,
      latency_ms: result.latencyMs,
      error: result.error ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not save the probe receipt: ${error.message}`);
  return { ok: result.ok, probeId: data.id as string, error: result.error ?? null };
}

export async function startRun(args: {
  client: SupabaseClient;
  workspaceId: string;
  agentId: string;
  agentConfig: AgentConfig;
  policyId: string;
  policyBody: string;
  suiteId: string;
  suite: Suite;
  attestation: string | null;
  baselineRunId?: string | null;
  createdBy?: string | null;
  judgeSource: "trial_free" | "workspace_key";
}): Promise<RunSummary> {
  const { client, workspaceId, agentId, agentConfig, policyId, policyBody, suiteId, suite } = args;

  const declared = await manifestForNewRun({
    client, agentId, policyId, suiteId, judgeSource: args.judgeSource,
  });

  const { data: run, error } = await client
    .from("runs")
    .insert({
      id: declared.id,
      manifest: declared.manifest,
      manifest_hash: declared.manifest_hash,
      workspace_id: workspaceId,
      agent_id: agentId,
      policy_id: policyId,
      suite_id: suiteId,
      baseline_run_id: args.baselineRunId ?? null,
      status: "queued",
      judge_source: args.judgeSource,
      attestation_text: args.attestation,
      created_by: args.createdBy ?? null,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not create the run: ${error.message}`);

  const adapter = await buildAgentAdapter({ client, workspaceId, agentId, config: agentConfig });
  const judge = createRoutedChat({
    connections: connectionsFromEnv(),
    routes: DEFAULT_ROUTES,
    onFallback: (attempt) =>
      console.warn(`  judge fallback: ${attempt.connection}/${attempt.model} — ${attempt.error}`),
  });

  // The read-back, on this path too. `startRunExecution` has built one since Phase 3;
  // this path did not, which meant a run started here reported every claimed action as
  // unverified even for an agent whose read-back endpoint was configured and working.
  // Two entry points to one product cannot disagree about what counts as evidence.
  const { data: agentRow } = await client
    .from("agents").select("verification, is_production").eq("id", agentId).maybeSingle();

  return executeRun({
    runId: run.id as string,
    suite,
    agent: adapter,
    policy: policyBody,
    judge,
    store: supabaseRunStore(client, workspaceId),
    verifier: await buildVerifier({
      client, workspaceId, agentId, verification: agentRow?.verification ?? null,
    }),
    agentIsProduction: agentRow?.is_production !== false,
  });
}

export interface PublishedReport {
  reportId: string;
  token: string;
  contentHash: string;
  expiresAt: string;
}

/**
 * Builds the client-facing payload and stores it with its hash and a share token.
 *
 * `buildReport` throws if anything private reached the payload, so a leak fails the
 * publish rather than becoming a URL.
 */
export async function publishReport(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  summary: RunSummary;
  clientName: string;
  agentName: string;
  policyVersion: number;
  policyBody: string;
  environment: string;
  attestation: string | null;
  suite: { key: string; version: number; name: string };
  judgeSource: "trial_free" | "workspace_key";
  /** The pass mark this run was measured against, read from the run row. */
  passThreshold: number;
  /** Wall time the customer actually waited, across every execution slice. */
  durationMs: number | null;
  baseline?: { runId: string; policyVersion: number; cases: Array<{ caseId: string; status: "pass" | "fail" | "error" }> };
  expiresInDays?: number;
}): Promise<PublishedReport> {
  const { client, workspaceId, runId, summary } = args;

  // Both read here rather than passed in: every caller of this function would
  // otherwise have to remember, and a forgotten argument would silently publish a
  // report with no manifest rather than failing.
  const { data: runRow } = await client
    .from("runs").select("manifest_hash, agent_id").eq("id", runId).maybeSingle();

  let previousReportHash: string | null = null;
  if (runRow?.agent_id) {
    const { data: earlier } = await client
      .from("reports")
      .select("content_hash, runs!inner(agent_id)")
      .eq("runs.agent_id", runRow.agent_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    previousReportHash = (earlier?.content_hash as string | undefined) ?? null;
  }

  const { payload, contentHash } = buildReport({
    manifestHash: (runRow?.manifest_hash as string | null) ?? null,
    previousReportHash,
    client: args.clientName,
    agentName: args.agentName,
    policyVersion: args.policyVersion,
    runId,
    runDate: new Date().toISOString().slice(0, 10),
    environment: args.environment,
    passThreshold: args.passThreshold,
    durationMs: args.durationMs,
    byCategory: summary.byCategory,
    suite: args.suite,
    attestation: args.attestation,
    judge: { source: args.judgeSource },
    cases: summary.cases,
    coverage: summary.coverage,
    byObligation: summary.byObligation,
    baseline: args.baseline,
    // Checked verbatim against the payload before anything is stored.
    privateMaterial: [args.policyBody],
  });

  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + (args.expiresInDays ?? 30) * 86_400_000).toISOString();

  const { data, error } = await client
    .from("reports")
    .insert({
      workspace_id: workspaceId,
      run_id: runId,
      token,
      content_hash: contentHash,
      payload,
      expires_at: expiresAt,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not store the report: ${error.message}`);
  return { reportId: data.id as string, token, contentHash, expiresAt };
}
