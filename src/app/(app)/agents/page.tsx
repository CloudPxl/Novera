import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { can } from "@/lib/auth/permissions.ts";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { PageHeader, Panel, Rows, TabNav } from "@/components/ui/page.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { summariseRun } from "../dashboard/summary.ts";

export const metadata: Metadata = { title: "Agents · Novera" };
export const dynamic = "force-dynamic";

function hostOf(config: unknown): string {
  try { return new URL(String((config as { url?: unknown })?.url ?? "")).host || "no endpoint"; } catch { return "no endpoint"; }
}

/**
 * The agents in this workspace, one row each: connection, policy version, latest outcome.
 * Everything about one agent — policy, runs, schedule, connection — is on its own page. A
 * person with a single agent in personal mode goes straight there: a list of one is a detour.
 *
 * Archived agents (0063) are behind `?archived=1`: out of the way, never gone. Their runs
 * and reports stay readable from their own pages.
 */
export default async function AgentsPage({ searchParams }: { searchParams: Promise<{ archived?: string }> }) {
  const showArchived = (await searchParams).archived === "1";
  const { workspace, role, context } = await requireWorkspace();
  const db = await sessionClient();
  const [{ data: all }, { data: policies }, { data: probes }, { data: runs }] = await Promise.all([
    db.from("agents").select("id, name, config, attested_at, is_production, archived_at").eq("workspace_id", workspace.id).order("created_at"),
    db.from("policies").select("agent_id, version").eq("workspace_id", workspace.id).order("version", { ascending: false }),
    db.from("probes").select("agent_id, error, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(60),
    db.from("runs").select("id, agent_id, status, created_at").eq("workspace_id", workspace.id).eq("status", "completed").order("created_at", { ascending: false }).limit(60),
  ]);
  const active = (all ?? []).filter((a) => !a.archived_at);
  const archivedCount = (all ?? []).length - active.length;
  const list = showArchived ? (all ?? []).filter((a) => a.archived_at) : active;
  if (!showArchived && archivedCount === 0 && context.accountMode === "personal" && list.length === 1) redirect(`/agents/${list[0].id}`);

  const latestRun = new Map<string, { id: string; created_at: string }>();
  for (const r of runs ?? []) if (!latestRun.has(r.agent_id as string)) latestRun.set(r.agent_id as string, { id: r.id as string, created_at: r.created_at as string });
  const runIds = [...latestRun.values()].map((r) => r.id);
  const { data: reports } = runIds.length ? await db.from("reports").select("run_id, payload").in("run_id", runIds) : { data: [] };
  const payloadOf = new Map((reports ?? []).map((r) => [r.run_id as string, r.payload]));

  return (
    <main className="w-full pb-8 text-ink">
      <PageHeader
        eyebrow={context.accountMode === "personal" ? "My agents" : "Library"}
        title="Agents"
        description="Each agent's policy, runs, schedule and connection are on its own page."
        action={can(role, "agent.write") ? <ButtonLink href="/agents/new">Connect an agent</ButtonLink> : undefined}
      />
      {archivedCount > 0 && (
        <div className="mb-4">
          <TabNav label="Which agents" current={showArchived ? "archived" : "active"} tabs={[
            { key: "active", label: "Active", href: "/agents", count: active.length },
            { key: "archived", label: "Archived", href: "/agents?archived=1", count: archivedCount },
          ]} />
        </div>
      )}
      {showArchived && list.length === 0 ? (
        <EmptyState title="No archived agents">An archived agent takes no new run or schedule. Its runs and reports are kept.</EmptyState>
      ) : list.length === 0 ? (
        <EmptyState title="No agents yet" action={can(role, "agent.write") ? <ButtonLink href="/agents/new">Connect an agent</ButtonLink> : undefined}>
          Connect an agent you own, or one you have permission to test. Novera makes one harmless request first so you can see the answer.
        </EmptyState>
      ) : (
        <Panel>
          <Rows label="Agents">
            {list.map((a) => {
              const id = a.id as string;
              const policy = (policies ?? []).find((p) => p.agent_id === id);
              const probe = (probes ?? []).find((p) => p.agent_id === id);
              const run = latestRun.get(id);
              const sum = run ? summariseRun({ status: "completed", payload: (payloadOf.get(run.id) as never) ?? null, scheduleId: null, apiKeyName: null }) : null;
              return (
                <li key={id}>
                  <Link href={`/agents/${id}`} className="grid gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-ground md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
                    <span className="min-w-0">
                      <span className="block font-medium">{a.name as string}</span>
                      <span className="block truncate type-mono text-xs text-ink-faint">{hostOf(a.config)}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-1.5 text-xs text-ink-soft">
                      {probe?.error ? <Badge tone="fail">Not answering</Badge> : probe ? <Badge tone="pass">Answering</Badge> : <Badge tone="neutral">Never checked</Badge>}
                      {a.archived_at && <Badge tone="neutral">Archived {formatWhen(a.archived_at as string, context.profile, { date: true })}</Badge>}
                      {!a.attested_at && <Badge tone="error">No authorisation</Badge>}
                      <span>{policy ? `policy v${policy.version}` : "no policy yet"}</span>
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs text-ink-faint">
                      {sum && run ? <><Badge tone={sum.tone}>{sum.stateLabel}</Badge>{formatWhen(run.created_at, context.profile, { date: true })}</> : "No completed run"}
                    </span>
                  </Link>
                </li>
              );
            })}
          </Rows>
        </Panel>
      )}
    </main>
  );
}
