import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseStatus } from "./coverage.ts";
import { unstableCases, type CaseStability, type HistoricalRun } from "./stability.ts";

/** Enough history to see a pattern, bounded so a busy agent's page stays two queries. */
const MAX_RUNS = 30;

/**
 * The completed runs of one suite version against one agent, up to and including a
 * given run, and the scenarios whose verdict has moved under an unchanged policy.
 *
 * "Up to" matters for a sealed report: it states what was known when it was sealed,
 * and a run finished next week must not change what last week's document says. Two
 * queries whatever the history length — runs, then their cases in one `in` — because
 * the run page is already the heaviest page in the product.
 */
export async function loadStability(args: {
  client: SupabaseClient;
  agentId: string;
  suiteId: string;
  /** Only runs created at or before this instant count. */
  asOf: string;
}): Promise<Map<string, CaseStability>> {
  const { data: runs } = await args.client
    .from("runs")
    .select("id, policy_id")
    .eq("agent_id", args.agentId)
    .eq("suite_id", args.suiteId)
    .eq("status", "completed")
    .lte("created_at", args.asOf)
    .order("created_at", { ascending: false })
    .limit(MAX_RUNS);

  if (!runs || runs.length < 2) return new Map();

  const { data: cases } = await args.client
    .from("run_cases")
    .select("run_id, case_id, status")
    .in("run_id", runs.map((r) => r.id as string));

  const byRun = new Map<string, HistoricalRun>(
    runs.map((r) => [r.id as string, { runId: r.id as string, policyId: r.policy_id as string, cases: [] }]),
  );
  for (const c of cases ?? []) {
    byRun.get(c.run_id as string)?.cases.push({ caseId: c.case_id as string, status: c.status as CaseStatus });
  }

  return unstableCases([...byRun.values()]);
}
