import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { diagnoseFailure } from "../diagnose/index.ts";
import { recordModelOperation, workspaceChat, type Funding, type WorkspaceChat } from "../providers/model-work.ts";
import { compileScenarios } from "../scenarios/compile.ts";
import { coveredBehaviours } from "../scenarios/promote.ts";
import type { SuiteCase } from "../runner/types.ts";

/**
 * The two things a model may propose and a person then decides: scenarios drafted from a
 * policy, and a diagnosis of a failed scenario. One implementation each, called by the
 * buttons (server actions, a person) and by the MCP tools (an API key with the `write`
 * scope) — so what an assistant can ask for is exactly what the button does, and nothing
 * either of them does can approve anything.
 *
 * Who asked is recorded on the row: the person, or the key and the person who created it
 * (0039), the same rule a run follows.
 */

export interface Requester {
  /** The person responsible: whoever pressed the button, or the key's creator. */
  userId: string | null;
  /** The key that asked, when an assistant did. */
  apiKeyId?: string | null;
}

export type Proposed<T> = { ok: true; value: T } | { ok: false; error: string };

/** The operation's row in `model_operations`: what answered, who paid, whether it was usable. */
async function settle(db: SupabaseClient, work: WorkspaceChat, operation: "diagnose" | "draft", workspaceId: string, by: Requester, usable: boolean, detail?: string | null) {
  await recordModelOperation(db, {
    workspaceId, operation, funding: work.funding,
    outcome: usable ? "ok" : work.calls.some((c) => c.served_by) ? "no_usable_output" : "error",
    calls: work.calls, detail: usable ? null : detail ?? null, requestedBy: by.userId, apiKeyId: by.apiKeyId ?? null,
  });
}

export interface DraftedScenarios {
  policyVersion: number;
  drafts: Array<{ id: string; scenarioId: string; input: string; quote: string; riskLevel: string }>;
  /** Drafts the model produced that did not hold up and were not stored. */
  refused: number;
  servedBy: string | null;
  /** Whose key the model ran on: the workspace's own, or the trial allowance. */
  funding: Funding;
}

export async function draftScenariosFromPolicy(args: {
  db: SupabaseClient;
  workspaceId: string;
  agentId: string;
  wanted: number;
  by: Requester;
}): Promise<Proposed<DraftedScenarios>> {
  const { db, workspaceId, agentId } = args;

  const { data: agent } = await db
    .from("agents").select("id").eq("id", agentId).eq("workspace_id", workspaceId).maybeSingle();
  if (!agent) return { ok: false, error: "That agent could not be found in this workspace." };

  // The latest policy version, because that is the document the agent is held to now.
  const { data: policy } = await db
    .from("policies").select("id, version, body")
    .eq("agent_id", agentId).eq("workspace_id", workspaceId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) {
    return { ok: false, error: "This agent has no policy version yet. A scenario needs a written duty to test." };
  }

  // Everything already drafted for this workspace: ids so a new draft never reuses
  // one, expectations so the model extends the coverage rather than restating it.
  const { data: existing } = await db.from("scenario_drafts").select("scenario").eq("workspace_id", workspaceId);
  const existingCases = (existing ?? [])
    .map((row) => row.scenario as SuiteCase)
    .filter((c): c is SuiteCase => Boolean(c?.id));

  // The workspace's own key when it has one, with no fallback to ours.
  const work = await workspaceChat({ client: db, workspaceId });
  if ("error" in work) return { ok: false, error: work.error };
  const outcome = await compileScenarios({
    chat: work.chat,
    policyBody: policy.body as string,
    existing: coveredBehaviours(existingCases),
    wanted: args.wanted,
    usedIds: existingCases.map((c) => c.id),
  });
  await settle(db, work, "draft", workspaceId, args.by, Boolean(outcome.ok && outcome.parsed), outcome.error);
  if (!outcome.ok || !outcome.parsed) return { ok: false, error: outcome.error ?? "No usable scenarios came back." };

  const servedBy = outcome.servedBy ? `${outcome.servedBy.connection}/${outcome.servedBy.model}` : null;
  const rows = outcome.parsed.drafts.map((d) => ({
    workspace_id: workspaceId,
    agent_id: agentId,
    policy_id: policy.id,
    source_quote: d.quote,
    scenario: d.scenario,
    duty_refs: d.dutyRefs,
    risk_level: d.riskLevel,
    destructive: d.destructive,
    fixture_only: d.fixtureOnly,
    model: servedBy,
    created_by: args.by.userId,
    api_key_id: args.by.apiKeyId ?? null,
  }));

  const { data: saved, error } = await db.from("scenario_drafts").insert(rows).select("id, scenario, source_quote, risk_level");
  if (error) return { ok: false, error: `Could not save the drafts: ${error.message}` };

  return {
    ok: true,
    value: {
      policyVersion: policy.version as number,
      drafts: (saved ?? []).map((r) => ({
        id: r.id as string,
        scenarioId: (r.scenario as SuiteCase).id,
        input: (r.scenario as SuiteCase).input,
        quote: r.source_quote as string,
        riskLevel: r.risk_level as string,
      })),
      refused: outcome.parsed.refused.length,
      servedBy,
      funding: work.funding,
    },
  };
}

export interface ProposedDiagnosis {
  id: string;
  runId: string;
  scenarioId: string;
  analysis: string;
  quotedOld: string | null;
  proposedNew: string | null;
  risks: unknown;
  servedBy: string | null;
  funding: Funding;
}

/**
 * Asks a model why one scenario failed and what policy change would have prevented it.
 *
 * Written against the policy version the run actually used, not the latest one, because
 * it explains something that already happened. Stored as `proposed`: nothing here
 * changes a policy. A failed attempt is not stored — a row saying "the model could not
 * help" would only clutter the decision list.
 */
export async function diagnoseRunCase(args: {
  db: SupabaseClient;
  workspaceId: string;
  runCaseId: string;
  by: Requester;
}): Promise<Proposed<ProposedDiagnosis>> {
  const { db, workspaceId } = args;

  const { data: runCase, error } = await db
    .from("run_cases")
    .select("id, run_id, case_id, obligation, severity, input, expected, assertions, response_text, rationale, status, raw_expired_at")
    .eq("id", args.runCaseId)
    .eq("workspace_id", workspaceId)
    .maybeSingle();

  if (error || !runCase) return { ok: false, error: "That scenario could not be found." };
  if (runCase.status === "pass") return { ok: false, error: "That scenario passed; there is nothing to diagnose." };
  // A scenario with no result — graders that could not answer or deadlocked, an action
  // nothing could verify, an agent that did not reply — has no failure to explain. A
  // proposal would have a model invent one and suggest a policy change for it.
  if (runCase.status !== "fail") {
    return { ok: false, error: "That scenario has no verdict, so there is no failure to diagnose. Retest it to get one." };
  }
  // A diagnosis reads what the agent said. Without it, a proposal would be a guess
  // from the rationale alone, presented as though it had read the reply.
  if (runCase.raw_expired_at) {
    return { ok: false, error: "The agent's reply for this scenario was removed under this workspace's retention setting, so it cannot be diagnosed. Retest the scenario to get a fresh reply." };
  }

  const { data: run } = await db.from("runs").select("policy_id").eq("id", runCase.run_id).single();
  const { data: policy } = run
    ? await db.from("policies").select("id, body").eq("id", run.policy_id).single()
    : { data: null };
  if (!policy) return { ok: false, error: "The policy this run used could not be loaded." };

  const work = await workspaceChat({ client: db, workspaceId });
  if ("error" in work) return { ok: false, error: work.error };
  const outcome = await diagnoseFailure({
    chat: work.chat,
    policyBody: policy.body as string,
    failure: {
      caseId: runCase.case_id as string,
      obligation: runCase.obligation as string,
      severity: runCase.severity as string,
      input: runCase.input as string,
      expected: runCase.expected as string,
      assertions: Array.isArray(runCase.assertions) ? (runCase.assertions as string[]) : [],
      responseText: (runCase.response_text as string | null) ?? null,
      rationale: (runCase.rationale as string | null) ?? null,
    },
  });
  await settle(db, work, "diagnose", workspaceId, args.by, Boolean(outcome.ok && outcome.change), outcome.error);
  if (!outcome.ok || !outcome.change) return { ok: false, error: outcome.error ?? "No usable proposal came back." };

  const { data: saved, error: insertError } = await db.from("diagnoses").insert({
    workspace_id: workspaceId,
    run_case_id: runCase.id,
    analysis: outcome.change.analysis,
    quoted_old: outcome.change.quotedOld,
    proposed_new: outcome.change.proposedNew,
    risks: outcome.change.risks,
    status: "proposed",
    requested_by: args.by.userId,
    api_key_id: args.by.apiKeyId ?? null,
  }).select("id").single();
  if (insertError || !saved) return { ok: false, error: `Could not save the proposal: ${insertError?.message ?? "no row"}` };

  return {
    ok: true,
    value: {
      id: saved.id as string,
      runId: runCase.run_id as string,
      scenarioId: runCase.case_id as string,
      analysis: outcome.change.analysis,
      quotedOld: outcome.change.quotedOld ?? null,
      proposedNew: outcome.change.proposedNew ?? null,
      risks: outcome.change.risks ?? null,
      servedBy: outcome.servedBy ? `${outcome.servedBy.connection}/${outcome.servedBy.model}` : null,
      funding: work.funding,
    },
  };
}
