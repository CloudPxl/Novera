import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Membership } from "@/lib/auth/session.ts";
import { summariseRun, type RunSummary } from "@/app/(app)/dashboard/summary.ts";

export interface PortfolioRow {
  membership: Membership;
  agents: number;
  inFlight: number;
  newest: { id: string; createdAt: string } | null;
  summary: RunSummary | null;
}

/**
 * Each of a person's workspaces with its newest completed run's outcome, read from its sealed
 * report. Called with the person's own verified memberships only, so the service role reads
 * nothing they could not open themselves. Ordered by what needs someone: failures, then missing
 * evidence, then runs in flight, then the rest.
 */
export async function portfolio(admin: SupabaseClient, memberships: Membership[]): Promise<PortfolioRow[]> {
  const ids = memberships.map((m) => m.workspace.id);
  if (!ids.length) return [];
  const [{ data: agents }, { data: runs }] = await Promise.all([
    admin.from("agents").select("workspace_id").in("workspace_id", ids).is("archived_at", null),
    admin.from("runs").select("id, workspace_id, status, created_at").in("workspace_id", ids)
      .order("created_at", { ascending: false }).limit(300),
  ]);
  const newest = new Map<string, { id: string; createdAt: string }>();
  const active = new Map<string, number>();
  for (const r of runs ?? []) {
    const ws = r.workspace_id as string;
    if (r.status === "completed" && !newest.has(ws)) newest.set(ws, { id: r.id as string, createdAt: r.created_at as string });
    if (r.status === "queued" || r.status === "running") active.set(ws, (active.get(ws) ?? 0) + 1);
  }
  const newestIds = [...newest.values()].map((r) => r.id);
  const { data: reports } = newestIds.length
    ? await admin.from("reports").select("run_id, payload").in("run_id", newestIds)
    : { data: [] };
  const payloadOf = new Map((reports ?? []).map((r) => [r.run_id as string, r.payload]));

  const rows: PortfolioRow[] = memberships.map((m) => {
    const run = newest.get(m.workspace.id) ?? null;
    return {
      membership: m,
      agents: (agents ?? []).filter((a) => a.workspace_id === m.workspace.id).length,
      inFlight: active.get(m.workspace.id) ?? 0,
      newest: run,
      summary: run ? summariseRun({ status: "completed", payload: (payloadOf.get(run.id) as never) ?? null, scheduleId: null, apiKeyName: null }) : null,
    };
  });
  const rank = (r: PortfolioRow) => (r.summary?.state === "fail" ? 0 : r.summary?.state === "incomplete" ? 1 : r.inFlight ? 2 : 3);
  return rows.sort((a, b) => rank(a) - rank(b) || a.membership.workspace.name.localeCompare(b.membership.workspace.name));
}
