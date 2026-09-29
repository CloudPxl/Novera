import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { LENSES, type Lens } from "../runs/[id]/lenses.ts";
import type { CaseRow } from "../runs/[id]/case-table.tsx";

export const metadata: Metadata = { title: "Review · Novera" };
export const dynamic = "force-dynamic";

/** How far back the queue looks. Older runs are one click away on each agent's page. */
const RECENT_RUNS = 10;

/**
 * The lenses a reviewer works through, in the order they matter. "New since baseline"
 * is left out: it needs a run to compare against, which is a choice made on the run.
 */
const QUEUE: Lens[] = ["review", "contradicted", "evidence", "disagreed", "rights", "transparency", "sensitive"];

/**
 * Everything waiting for a person, across the workspace's recent runs — the same lenses
 * as the run page, counted per run, each count a link to that run already filtered.
 * Nothing here is computed differently from the run page: the lens is the same function
 * over the same stored fields, so the two cannot disagree about what needs a look.
 */
export default async function ReviewPage() {
  const { user, workspace } = await requireWorkspace();
  const db = await assertMembership(user.id, workspace.id);

  const [{ data: runs }, { count: pendingDrafts }, { data: proposals }, { data: inFlight }, { data: contradicted }] = await Promise.all([
    db.from("runs")
      .select("id, created_at, suite_id, agents(name), suites(key, version, name, cases)")
      .eq("workspace_id", workspace.id).eq("status", "completed")
      .order("created_at", { ascending: false }).limit(RECENT_RUNS),
    db.from("scenario_drafts").select("id", { count: "exact", head: true })
      .eq("workspace_id", workspace.id).eq("status", "draft"),
    db.from("diagnoses")
      .select("id, created_at, run_cases(run_id, case_id)")
      .eq("workspace_id", workspace.id).eq("status", "proposed")
      .order("created_at", { ascending: false }).limit(20),
    db.from("runs").select("id, status, created_at, agents(name)")
      .eq("workspace_id", workspace.id).in("status", ["queued", "running"])
      .order("created_at", { ascending: false }),
    db.from("evidence_observations").select("run_case_id")
      .eq("workspace_id", workspace.id).eq("status", "contradicted"),
  ]);

  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: caseRows } = runIds.length
    ? await db.from("run_cases")
      .select("id, run_id, case_id, status, severity, category, evidence_gap, judge_agreement")
      .in("run_id", runIds)
    : { data: [] };

  const contradictedIds = new Set((contradicted ?? []).map((o) => o.run_case_id as string));

  const perRun = (runs ?? []).map((run) => {
    const suite = run.suites as unknown as { key: string; version: number; name: string; cases: Array<{ id: string; duty_refs?: string[] }> } | null;
    const duty = new Map((suite?.cases ?? []).map((c) => [c.id, Array.isArray(c.duty_refs) ? c.duty_refs : []]));
    // Only the fields the lenses read; the rest of a row is the run page's business.
    const rows = (caseRows ?? []).filter((c) => c.run_id === run.id).map((c) => ({
      status: c.status,
      severity: c.severity,
      category: c.category,
      evidenceGap: c.evidence_gap ?? null,
      judgeAgreement: c.judge_agreement ?? null,
      observation: contradictedIds.has(c.id as string) ? { status: "contradicted" } : null,
      regression: false,
      dutyRefs: duty.get(c.case_id as string) ?? [],
    }) as unknown as CaseRow);
    const counts = QUEUE.map((key) => {
      const lens = LENSES.find((l) => l.key === key)!;
      return { key, label: lens.label, hint: lens.hint, count: rows.filter(lens.match).length };
    });
    return {
      id: run.id as string,
      agent: (run.agents as unknown as { name: string } | null)?.name ?? "agent",
      suite: suite ? `${suite.key} v${suite.version}` : "suite",
      date: (run.created_at as string).slice(0, 10),
      counts,
      total: counts.reduce((n, c) => n + c.count, 0),
    };
  });

  const waiting = perRun.filter((r) => r.total > 0);
  const openProposals = (proposals ?? []).map((p) => ({
    id: p.id as string,
    ...(p.run_cases as unknown as { run_id: string; case_id: string }),
  }));

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      <h1 className="type-h1">Review</h1>
      <p className="mt-2 max-w-2xl type-body text-ink-soft">
        What needs a person, across your last {RECENT_RUNS} completed runs. Each number opens that run
        with the same filter applied. Nothing here is a verdict of its own — it is where to look.
      </p>

      {(inFlight?.length ?? 0) > 0 && (
        <Reveal className="mt-8">
          <h2 className="type-h3">In progress</h2>
          <ul className="mt-3 space-y-2">
            {(inFlight ?? []).map((r) => (
              <li key={r.id as string}>
                <Link href={`/runs/${r.id}`} className="text-sm underline underline-offset-2 hover:text-ink-soft">
                  {(r.agents as unknown as { name: string } | null)?.name ?? "agent"} — {r.status === "queued" ? "starting" : "running"} since {(r.created_at as string).slice(0, 16).replace("T", " ")} UTC
                </Link>
              </li>
            ))}
          </ul>
        </Reveal>
      )}

      <Reveal className="mt-8">
        <h2 className="type-h3">Waiting for your decision</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <Card className="p-4">
            <p className="text-sm font-medium">Scenario drafts</p>
            <p className="mt-1 text-sm text-ink-soft">
              {pendingDrafts
                ? <><Link href="/scenarios" className="underline underline-offset-2">{pendingDrafts} waiting</Link> to be approved or rejected. A draft cannot run until someone approves it.</>
                : "None waiting."}
            </p>
          </Card>
          <Card className="p-4">
            <p className="text-sm font-medium">Proposed policy changes</p>
            {openProposals.length ? (
              <ul className="mt-1 space-y-1 text-sm">
                {openProposals.map((p) => (
                  <li key={p.id}>
                    <Link href={`/runs/${p.run_id}`} className="underline underline-offset-2">{p.case_id}</Link>
                    <span className="text-ink-soft"> — a diagnosis to approve or reject</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-sm text-ink-soft">None waiting.</p>
            )}
          </Card>
        </div>
      </Reveal>

      <Reveal className="mt-10">
        <h2 className="type-h3">Scenarios to look at</h2>
        {!runs?.length ? (
          <div className="mt-3">
            <EmptyState title="No completed runs yet">
              When a run finishes, anything in it that needs a person is listed here.
            </EmptyState>
          </div>
        ) : !waiting.length ? (
          <p className="mt-3 text-sm text-ink-soft">
            Nothing in the last {perRun.length} completed run{perRun.length === 1 ? "" : "s"} matches a review filter.
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {waiting.map((r) => (
              <li key={r.id}>
                <Card className="p-4">
                  <p className="text-sm font-medium">
                    <Link href={`/runs/${r.id}`} className="underline underline-offset-2">{r.agent}</Link>
                    <span className="font-normal text-ink-soft"> · {r.suite} · {r.date}</span>
                  </p>
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {r.counts.filter((c) => c.count > 0).map((c) => (
                      <li key={c.key}>
                        <Link href={`/runs/${r.id}?lens=${c.key}`} title={c.hint} className="inline-flex rounded-full focus-visible:outline-2">
                          <Badge tone={c.key === "review" || c.key === "contradicted" ? "fail" : "neutral"}>
                            {c.count} · {c.label}
                          </Badge>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </Reveal>
    </main>
  );
}
