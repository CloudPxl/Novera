import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { normaliseTrajectory } from "../agents/trajectory.ts";
import { noVerdictRow, repairFor } from "../evidence/repair.ts";
import { completionOf, eligibleScenarios, mergeChainRows, MAX_COMPLETIONS, type ChainLink } from "../evidence/completion.ts";

/**
 * What a completion of a run would re-execute, checked against the stored evidence before
 * `startRun` declares anything (0083). Refusals come back as values: `startRun` words them as its
 * own, so there is still one way to start a run.
 */
export interface CompletionPlan {
  target: {
    id: string;
    agent_id: string;
    suite_id: string;
    policy_id: string;
    judge_source: string;
    manifest: Record<string, unknown>;
  };
  /** The report being completed: the newest sealed for the target run. */
  reportHash: string;
  reportDate: string;
  /** The runs whose rows the new report draws on, newest first, ending with the original. */
  chain: ChainLink[];
  /** In suite order. */
  scenarioIds: string[];
}

const RUN_COLUMNS = "id, workspace_id, agent_id, suite_id, policy_id, status, judge_source, manifest";

export async function planCompletion(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  scenarioIds: readonly string[];
}): Promise<CompletionPlan | { error: string }> {
  const { client, workspaceId, runId } = args;
  if (!args.scenarioIds.length) return { error: "Name at least one scenario to complete." };

  const { data: target } = await client.from("runs").select(RUN_COLUMNS).eq("id", runId).eq("workspace_id", workspaceId).maybeSingle();
  if (!target) return { error: "That run could not be found in this workspace." };
  if (target.status !== "completed") return { error: "Only a completed run with a sealed report can be completed. A run that stopped is rerun instead." };
  const manifest = (target.manifest ?? null) as Record<string, unknown> | null;
  if (!manifest) return { error: "This run declared no manifest, so a completion could not show that it ran under the same terms. Rerun the suite." };

  const { data: report } = await client.from("reports").select("content_hash, payload, revoked_at")
    .eq("run_id", runId).eq("workspace_id", workspaceId).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!report) return { error: "This run has no sealed report to complete." };
  if (report.revoked_at) return { error: "This run's report was withdrawn, so it is not completed. Rerun the suite." };

  // The chain of completions this run already ends: at most MAX_COMPLETIONS deep.
  const chain: ChainLink[] = [{ runId, declared: completionOf(manifest)?.scenario_ids ?? null }];
  let next = completionOf(manifest);
  while (next) {
    if (chain.length > MAX_COMPLETIONS) break;
    const { data: earlier } = await client.from("runs").select("id, manifest").eq("id", next.run_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!earlier) return { error: "A run this one completes could not be read, so the evidence cannot be combined." };
    const c = completionOf(earlier.manifest);
    chain.push({ runId: earlier.id as string, declared: c?.scenario_ids ?? null });
    next = c;
  }
  if (chain.length - 1 >= MAX_COMPLETIONS) {
    return { error: `This evidence has already been completed ${MAX_COMPLETIONS} times. Rerun the suite for a report from one run.` };
  }

  const [{ data: rows }, { data: suite }] = await Promise.all([
    client.from("run_cases")
      .select("id, run_id, case_id, status, error, response_text, raw_expired_at, transcript, evidence_gap, judge_agreement, judge_attempts, tool_activity")
      .in("run_id", chain.map((l) => l.runId)).eq("workspace_id", workspaceId),
    client.from("suites").select("cases").eq("id", target.suite_id).maybeSingle(),
  ]);
  const merged = mergeChainRows(chain, (rows ?? []) as Array<{ id: string; run_id: string; case_id: string; status: unknown } & Record<string, unknown>>);
  const { data: observations } = merged.length
    ? await client.from("evidence_observations").select("run_case_id, status").in("run_case_id", merged.map((r) => r.id))
    : { data: [] };
  const observed = new Map((observations ?? []).map((o) => [o.run_case_id as string, o.status as string]));
  const cases = Array.isArray(suite?.cases) ? (suite!.cases as Array<{ id: string; effect?: unknown; destructive?: unknown }>) : [];
  const scenario = new Map(cases.map((c) => [c.id, c]));

  const byId = new Map<string, { status: string; retry: "safe" | "check_first" | "fix_first" | null }>();
  for (const row of merged) {
    const repair = repairFor(noVerdictRow(row, {
      observationStatus: observed.get(row.id) ?? null,
      scenario: scenario.get(row.case_id) ?? null,
      toolCalls: normaliseTrajectory(row.tool_activity).filter((e) => e.type === "tool_call").length,
    }));
    byId.set(row.case_id, { status: String(row.status), retry: repair?.retry ?? null });
  }

  const declared = ((manifest.suite as { case_ids?: unknown } | undefined)?.case_ids);
  const suiteOrder = cases.map((c) => c.id).filter((id) => chain.length > 1 || !Array.isArray(declared) || (declared as string[]).includes(id));
  const eligibility = eligibleScenarios({ requested: args.scenarioIds, suiteOrder, merged: byId });
  if (eligibility.refused.length) {
    return { error: `Not completed: ${eligibility.refused.map((r) => `${r.id} ${r.why}`).join("; ")}.` };
  }
  if (!eligibility.ok.length) return { error: "None of the named scenarios can be completed." };

  return {
    target: {
      id: target.id as string,
      agent_id: target.agent_id as string,
      suite_id: target.suite_id as string,
      policy_id: target.policy_id as string,
      judge_source: target.judge_source as string,
      manifest,
    },
    reportHash: report.content_hash as string,
    reportDate: String((report.payload as { run?: { date?: unknown } } | null)?.run?.date ?? ""),
    chain,
    scenarioIds: eligibility.ok,
  };
}
