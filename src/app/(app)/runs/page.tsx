import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { PageHeader, Panel, Rows } from "@/components/ui/page.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { summariseRun } from "../dashboard/summary.ts";

export const metadata: Metadata = { title: "Runs · Novera" };
export const dynamic = "force-dynamic";

const STATES = [
  { key: "all", label: "All" },
  { key: "fail", label: "Failed" },
  { key: "incomplete", label: "Evidence incomplete" },
  { key: "pass", label: "Passed" },
  { key: "running", label: "In progress" },
] as const;

/**
 * Every run in the workspace, newest first: one row each with its outcome — the release gate's,
 * read from the sealed report — and its counts. The run page holds everything else.
 */
export default async function RunsPage({ searchParams }: { searchParams: Promise<{ state?: string; agent?: string }> }) {
  const filter = await searchParams;
  const { workspace, context } = await requireWorkspace();
  const db = await sessionClient();
  const [{ data: runs }, { data: agents }, { data: keys }] = await Promise.all([
    db.from("runs").select("id, status, created_at, agent_id, schedule_id, api_key_id").eq("workspace_id", workspace.id)
      .order("created_at", { ascending: false }).limit(100),
    db.from("agents").select("id, name").eq("workspace_id", workspace.id),
    db.from("api_keys").select("id, name").eq("workspace_id", workspace.id),
  ]);
  const ids = (runs ?? []).map((r) => r.id as string);
  const { data: reports } = ids.length ? await db.from("reports").select("run_id, payload").in("run_id", ids) : { data: [] };
  const payloadOf = new Map((reports ?? []).map((r) => [r.run_id as string, r.payload]));
  const agentName = new Map((agents ?? []).map((a) => [a.id as string, a.name as string]));
  const keyName = new Map((keys ?? []).map((k) => [k.id as string, k.name as string]));

  const rows = (runs ?? []).map((r) => ({
    r,
    s: summariseRun({ status: r.status as string, payload: (payloadOf.get(r.id as string) as never) ?? null, scheduleId: (r.schedule_id as string | null) ?? null, apiKeyName: r.api_key_id ? keyName.get(r.api_key_id as string) ?? "key" : null }),
  }));
  const state = STATES.some((x) => x.key === filter.state) ? filter.state! : "all";
  const shown = rows.filter(({ r, s }) => (state === "all" || s.state === state) && (!filter.agent || r.agent_id === filter.agent));
  const personal = context.accountMode === "personal";
  const q = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ state: filter.state, agent: filter.agent, ...over })) if (v && v !== "all") p.set(k, v);
    return `/runs${p.size ? `?${p}` : ""}`;
  };

  return (
    <main className="w-full pb-8 text-ink">
      <PageHeader
        eyebrow={personal ? "My runs" : "Work"}
        title="Runs"
        description="Each run's outcome is the release gate's: pass, fail, or evidence incomplete. A run in progress shows no counts until it is done."
        action={<Link href="/review" className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Review queue →</Link>}
      />

      <nav aria-label="Filter runs" className="flex flex-wrap items-center gap-1.5">
        {STATES.map((x) => (
          <Link key={x.key} href={q({ state: x.key })} aria-current={state === x.key ? "true" : undefined}
            className={`rounded-full border px-3 py-1 text-xs font-medium ${state === x.key ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft hover:text-ink"}`}>
            {x.label} <span className="tnum">{x.key === "all" ? rows.length : rows.filter(({ s }) => s.state === x.key).length}</span>
          </Link>
        ))}
        {(agents ?? []).length > 1 && (
          <span className="ml-2 flex flex-wrap gap-x-3 text-xs text-ink-soft">
            <Link href={q({ agent: undefined })} className={!filter.agent ? "font-semibold text-ink" : "underline underline-offset-2"}>All agents</Link>
            {(agents ?? []).map((a) => (
              <Link key={a.id as string} href={q({ agent: a.id as string })} className={filter.agent === a.id ? "font-semibold text-ink" : "underline underline-offset-2"}>{a.name as string}</Link>
            ))}
          </span>
        )}
      </nav>

      <div className="mt-4">
        {rows.length === 0 ? (
          <EmptyState title="No runs yet">Connect an agent and save its policy; then run the suite from the agent&apos;s page or with Run evaluation.</EmptyState>
        ) : shown.length === 0 ? (
          <p className="rounded-panel border border-line bg-surface px-5 py-8 text-center text-sm text-ink-soft">No run matches this filter.</p>
        ) : (
          <Panel>
            <Rows label="Runs">
              {shown.map(({ r, s }) => (
                <li key={r.id as string}>
                  <Link href={`/runs/${r.id}`} className="grid gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-ground sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                    <span className="min-w-0">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{agentName.get(r.agent_id as string) ?? "Agent"}</span>
                        <Badge tone={s.tone} pulse={s.state === "running"}>{s.stateLabel}</Badge>
                        {s.band && s.state !== "pass" && s.state !== "running" && <span className="text-xs text-ink-soft">{s.band}</span>}
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-faint">{formatWhen(r.created_at as string, context.profile)} · {s.startedBy}</span>
                    </span>
                    {s.counts ? (
                      <span className="text-xs text-ink-soft tnum">
                        {s.counts.passed} passed{s.counts.failed > 0 && <span className="text-fail-text"> · {s.counts.failed} failed</span>}
                        {s.counts.noVerdict > 0 && <span className="text-warning-text"> · {s.counts.noVerdict} no verdict</span>}
                      </span>
                    ) : <span className="text-xs text-ink-faint">{s.state === "running" ? "In progress" : "Not sealed"}</span>}
                  </Link>
                </li>
              ))}
            </Rows>
          </Panel>
        )}
      </div>
    </main>
  );
}
