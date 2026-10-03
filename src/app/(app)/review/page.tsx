import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Disclosure, PageHeader, Panel, Rows, TabNav } from "@/components/ui/page.tsx";
import { LENSES, type Lens } from "../runs/[id]/lenses.ts";
import type { CaseRow } from "../runs/[id]/case-table.tsx";
import { noVerdictRow, repairFor, retryWords, type Repair } from "@/lib/evidence/repair.ts";
import { testFindings, FINDING_STATE_LABEL, type FindingRun, type Followup, type CaseStatus, type TestFinding } from "@/lib/review/findings.ts";
import { OBLIGATION_LABELS } from "@/lib/report/payload.ts";

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

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; agent?: string; severity?: string; view?: string; q?: string }>;
}) {
  const filter = await searchParams;
  // Older links name a finding state; they open the view that holds it.
  const VIEWS = ["attention", "incomplete", "regressions", "unverified", "approvals", "closed"] as const;
  type View = (typeof VIEWS)[number];
  const view: View = (VIEWS as readonly string[]).includes(filter.view ?? "") ? (filter.view as View)
    : filter.state === "new" ? "regressions" : filter.state === "resolved" ? "closed" : "attention";
  const q = (filter.q ?? "").trim().toLowerCase().slice(0, 80);
  const { user, workspace } = await requireWorkspace();
  const db = await assertMembership(user.id, workspace.id);

  const [{ data: runs }, { count: pendingDrafts }, { data: proposals }, { data: inFlight }, { data: contradicted }] = await Promise.all([
    db.from("runs")
      .select("id, created_at, suite_id, agent_id, agents(name), suites(key, version, name, cases)")
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
    db.from("evidence_observations").select("run_case_id, status")
      .eq("workspace_id", workspace.id).in("status", ["contradicted", "unavailable"]),
  ]);

  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: caseRows } = runIds.length
    ? await db.from("run_cases")
      .select("id, run_id, case_id, status, severity, category, obligation, evidence_gap, judge_agreement")
      .in("run_id", runIds)
    : { data: [] };

  // Failed scenarios as findings: new, recurring, not comparable, resolved — derived from
  // these same rows (src/lib/review/findings.ts), with what a person has already done.
  const [{ data: decided }, { data: retests }, { data: reviews }] = await Promise.all([
    db.from("diagnoses").select("run_case_id, status").eq("workspace_id", workspace.id).in("status", ["proposed", "approved", "rejected"])
      .order("created_at", { ascending: false }).limit(300),
    db.from("case_retests").select("run_case_id, status").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(300),
    db.from("verdict_reviews").select("run_case_id, finding").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(300),
  ]);
  const followups = new Map<string, Followup>();
  const touch = (id: string) => { const f = followups.get(id) ?? {}; followups.set(id, f); return f; };
  for (const d of decided ?? []) { const f = touch(d.run_case_id as string); f.proposal ??= d.status as Followup["proposal"]; }
  for (const t of retests ?? []) { const f = touch(t.run_case_id as string); f.retest ??= t.status as CaseStatus; }
  for (const v of reviews ?? []) { const f = touch(v.run_case_id as string); f.finding ??= v.finding as "pass" | "fail"; }
  const findingRuns: FindingRun[] = (runs ?? []).map((r) => ({
    id: r.id as string,
    agentId: r.agent_id as string,
    agentName: (r.agents as unknown as { name: string } | null)?.name ?? "agent",
    suiteId: r.suite_id as string,
    createdAt: r.created_at as string,
    cases: new Map((caseRows ?? []).filter((c) => c.run_id === r.id).map((c) => [c.case_id as string, {
      runCaseId: c.id as string, status: c.status as CaseStatus, severity: c.severity as string, obligation: (c.obligation as string | null) ?? null,
    }])),
  }));
  const allFindings = testFindings(findingRuns, followups);

  const contradictedIds = new Set((contradicted ?? []).filter((o) => o.status === "contradicted").map((o) => o.run_case_id as string));
  const unavailableIds = new Set((contradicted ?? []).filter((o) => o.status === "unavailable").map((o) => o.run_case_id as string));

  // Every scenario with no verdict in these runs, grouped by why — the same classifier
  // as the run page, over the same stored fields.
  const { data: noVerdictRows } = runIds.length
    ? await db.from("run_cases")
      .select("id, run_id, case_id, status, error, response_text, raw_expired_at, transcript, evidence_gap, judge_agreement, judge_attempts")
      .in("run_id", runIds).eq("status", "error")
    : { data: [] };
  const repairs = new Map<string, { repair: Repair; items: Array<{ runId: string; caseId: string; agent: string }> }>();
  for (const c of noVerdictRows ?? []) {
    const run = (runs ?? []).find((r) => r.id === c.run_id);
    const scenario = (run?.suites as unknown as { cases?: Array<{ id: string; effect?: unknown; destructive?: unknown }> } | null)?.cases?.find((s) => s.id === c.case_id) ?? null;
    const repair = repairFor(noVerdictRow(c, { observationStatus: unavailableIds.has(c.id as string) ? "unavailable" : null, scenario }));
    if (!repair) continue;
    const group = repairs.get(repair.reason) ?? { repair, items: [] };
    group.items.push({ runId: c.run_id as string, caseId: c.case_id as string, agent: (run?.agents as unknown as { name: string } | null)?.name ?? "agent" });
    repairs.set(repair.reason, group);
  }
  const repairGroups = [...repairs.values()].sort((a, b) => b.items.length - a.items.length);

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

  // Duty references per run and scenario, for each row's "affected duty".
  const dutyOf = new Map<string, string[]>();
  for (const run of runs ?? []) {
    const cases = (run.suites as unknown as { cases?: Array<{ id: string; duty_refs?: string[] }> } | null)?.cases ?? [];
    for (const c of cases) dutyOf.set(`${run.id}:${c.id}`, c.duty_refs ?? []);
  }
  const matches = (text: string) => !q || text.toLowerCase().includes(q);
  const findingText = (f: TestFinding) => `${f.caseId} ${f.agentName} ${f.obligation ?? ""} ${(OBLIGATION_LABELS as Record<string, string>)[f.obligation ?? ""] ?? ""}`;
  const scoped = (list: TestFinding[]) => list.filter((f) => (!filter.agent || f.agentId === filter.agent) && (!filter.severity || f.severity === filter.severity) && matches(findingText(f)));
  const attention = scoped(allFindings.filter((f) => f.state !== "resolved"));
  const regressions = scoped(allFindings.filter((f) => f.state === "new"));
  const closed = scoped(allFindings.filter((f) => f.state === "resolved"));

  // Claimed actions nobody could confirm, and claims the system of record contradicted, in each
  // agent's newest run.
  const newestRunIds = new Set(findingRuns.filter((r, i) => findingRuns.findIndex((x) => x.agentId === r.agentId) === i).map((r) => r.id));
  const unverified = (caseRows ?? [])
    .filter((c) => newestRunIds.has(c.run_id as string) && (c.evidence_gap || contradictedIds.has(c.id as string) || unavailableIds.has(c.id as string)))
    .map((c) => {
      const run = (runs ?? []).find((r) => r.id === c.run_id);
      return {
        id: c.id as string, runId: c.run_id as string, caseId: c.case_id as string, severity: c.severity as string,
        obligation: (c.obligation as string | null) ?? null, agent: (run?.agents as unknown as { name: string } | null)?.name ?? "agent",
        state: contradictedIds.has(c.id as string) ? "Contradicted by your system" : unavailableIds.has(c.id as string) ? "Read-back did not answer" : "No evidence the action happened",
      };
    })
    .filter((u) => matches(`${u.caseId} ${u.agent} ${u.obligation ?? ""}`));
  const incompleteCount = repairGroups.reduce((n, g) => n + g.items.length, 0);
  const approvalsCount = (pendingDrafts ?? 0) + openProposals.length;
  const tabHref = (v: View) => {
    const p = new URLSearchParams();
    if (v !== "attention") p.set("view", v);
    if (filter.q) p.set("q", filter.q);
    return `/review${p.size ? `?${p}` : ""}`;
  };
  const total = attention.length + incompleteCount + unverified.length + approvalsCount;

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        eyebrow="Work"
        title="Review"
        status={<Badge tone={total ? "high" : "pass"}>{total ? `${total} need action` : "Nothing waiting"}</Badge>}
        description={`What needs a person across your last ${RECENT_RUNS} completed runs. Each row opens the scenario where it is resolved.`}
      />

      {(inFlight?.length ?? 0) > 0 && (
        <p className="mb-4 text-sm text-ink-soft">
          {(inFlight ?? []).length} run{(inFlight ?? []).length === 1 ? "" : "s"} still in progress:{" "}
          {(inFlight ?? []).map((r, i) => (
            <span key={r.id as string}>{i > 0 && ", "}<Link href={`/runs/${r.id}`} className="underline underline-offset-2">{(r.agents as unknown as { name: string } | null)?.name ?? "agent"}</Link></span>
          ))}
          . Their findings appear here when they finish.
        </p>
      )}

      <form action="/review" className="mb-3 flex flex-wrap items-center gap-2">
        {view !== "attention" && <input type="hidden" name="view" value={view} />}
        <label htmlFor="review-q" className="sr-only">Search the queue</label>
        <input id="review-q" name="q" defaultValue={filter.q ?? ""} placeholder="Search by scenario, agent or duty" className="w-full max-w-sm rounded-control border border-line-strong bg-surface px-3 py-2 text-sm placeholder:text-ink-faint focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink" />
        <button type="submit" className="rounded-control border border-line-strong bg-surface px-3 py-2 text-sm font-medium hover:bg-sunken">Search</button>
        {filter.q && <Link href={tabHref(view).replace(/[?&]q=[^&]*/, "")} className="text-sm text-ink-soft underline underline-offset-2">Clear</Link>}
      </form>

      <TabNav label="Review views" current={view} tabs={[
        { key: "attention", label: "Needs attention", href: tabHref("attention"), count: attention.length },
        { key: "incomplete", label: "Evidence incomplete", href: tabHref("incomplete"), count: incompleteCount },
        { key: "regressions", label: "New regressions", href: tabHref("regressions"), count: regressions.length },
        { key: "unverified", label: "Unverified actions", href: tabHref("unverified"), count: unverified.length },
        { key: "approvals", label: "Awaiting approval", href: tabHref("approvals"), count: approvalsCount },
        { key: "closed", label: "Closed", href: tabHref("closed"), count: closed.length },
      ]} />

      <div className="mt-5">
        {!runs?.length && view !== "approvals" ? (
          <EmptyState title="No completed runs yet">When a run finishes, everything in it that needs a person is listed here.</EmptyState>
        ) : view === "attention" || view === "regressions" || view === "closed" ? (
          (() => {
            const list = view === "attention" ? attention : view === "regressions" ? regressions : closed;
            return list.length === 0 ? (
              <p className="rounded-shell border border-line bg-surface px-5 py-6 text-center text-sm text-ink-soft">
                {view === "attention" ? "No failed scenario in any agent's newest run." : view === "regressions" ? "Nothing broke since the previous comparable run." : "Nothing resolved since the previous comparable run."}
              </p>
            ) : (
              <Panel><Rows label="Findings">{list.map((f) => <FindingRow key={f.runCaseId} f={f} duty={dutyOf.get(`${f.runId}:${f.caseId}`) ?? []} />)}</Rows></Panel>
            );
          })()
        ) : view === "incomplete" ? (
          repairGroups.length === 0 ? (
            <p className="rounded-shell border border-line bg-surface px-5 py-6 text-center text-sm text-ink-soft">Every scenario in the recent runs reached a verdict.</p>
          ) : (
            <Panel>
              <Rows label="Scenarios without a verdict, by cause">
                {repairGroups.map(({ repair, items }) => (
                  <li key={repair.reason} className="px-5 py-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="flex flex-wrap items-center gap-2 text-sm font-medium">{repair.label}<Badge tone="error">{items.length}</Badge><span className="text-xs font-normal text-ink-faint">for {repair.owner}</span></p>
                      <span className="text-sm"><span className="font-medium">Next:</span> {repair.next}</span>
                    </div>
                    <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                      {items.slice(0, 12).map((i) => (
                        <li key={`${i.runId}-${i.caseId}`}><Link href={`/runs/${i.runId}?lens=noverdict&case=${i.caseId}`} className="underline underline-offset-2">{i.caseId}</Link><span className="text-ink-faint"> · {i.agent}</span></li>
                      ))}
                      {items.length > 12 && <li className="text-ink-faint">and {items.length - 12} more</li>}
                    </ul>
                    <details className="mt-2 text-xs text-ink-soft">
                      <summary className="cursor-pointer font-medium text-ink-soft hover:text-ink">What happened, and is a retry safe?</summary>
                      <p className="mt-1">{repair.happened}</p>
                      <p className="mt-1 text-ink-faint">{retryWords(repair)}</p>
                    </details>
                  </li>
                ))}
              </Rows>
            </Panel>
          )
        ) : view === "unverified" ? (
          unverified.length === 0 ? (
            <p className="rounded-shell border border-line bg-surface px-5 py-6 text-center text-sm text-ink-soft">Every action an agent claimed in its newest run was confirmed, or none was claimed.</p>
          ) : (
            <Panel>
              <Rows label="Unverified actions">
                {unverified.map((u) => (
                  <li key={u.id}>
                    <Link href={`/runs/${u.runId}?tab=cases&case=${encodeURIComponent(u.caseId)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-5 py-3 transition-colors hover:bg-ground">
                      <Badge tone={u.severity as "critical"}>{u.severity}</Badge>
                      <span className="type-mono text-xs text-ink-faint">{u.caseId}</span>
                      <span className="min-w-0 flex-1 text-sm font-medium">{u.obligation ? (OBLIGATION_LABELS as Record<string, string>)[u.obligation] ?? u.obligation : "Scenario"} <span className="font-normal text-ink-soft">· {u.agent}</span></span>
                      <span className={`text-xs font-medium ${u.state.startsWith("Contradicted") ? "text-fail-text" : "text-warning-text"}`}>{u.state}</span>
                    </Link>
                  </li>
                ))}
              </Rows>
            </Panel>
          )
        ) : (
          <Panel>
            <Rows label="Awaiting approval">
              <li className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-sm">
                <span><span className="font-medium">Scenario drafts</span> <span className="text-ink-soft">— {pendingDrafts ? `${pendingDrafts} waiting. A draft cannot run until someone approves it.` : "none waiting."}</span></span>
                {pendingDrafts ? <Link href="/scenarios" className="font-medium underline-offset-2 hover:underline">Decide →</Link> : null}
              </li>
              {openProposals.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3.5 text-sm">
                  <span><span className="font-medium">Proposed policy change</span> <span className="type-mono text-xs text-ink-faint">{p.case_id}</span> <span className="text-ink-soft">— a diagnosis to approve or reject</span></span>
                  <Link href={`/runs/${p.run_id}?case=${p.case_id}`} className="font-medium underline-offset-2 hover:underline">Decide →</Link>
                </li>
              ))}
              {openProposals.length === 0 && <li className="px-5 py-3.5 text-sm text-ink-soft">No proposed policy change is waiting.</li>}
            </Rows>
          </Panel>
        )}

        {view === "attention" && waiting.length > 0 && (
          <div className="mt-6">
            <Disclosure summary={`By run and lens · ${waiting.length} run${waiting.length === 1 ? "" : "s"}`}>
              <ul className="space-y-3">
                {waiting.map((r) => (
                  <li key={r.id}>
                    <p className="text-sm font-medium"><Link href={`/runs/${r.id}`} className="underline underline-offset-2">{r.agent}</Link><span className="font-normal text-ink-soft"> · {r.suite} · {r.date}</span></p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {r.counts.filter((c) => c.count > 0).map((c) => (
                        <li key={c.key}><Link href={`/runs/${r.id}?lens=${c.key}`} title={c.hint} className="inline-flex rounded-full focus-visible:outline-2"><Badge tone={c.key === "review" || c.key === "contradicted" ? "fail" : "neutral"}>{c.count} · {c.label}</Badge></Link></li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            </Disclosure>
          </div>
        )}
      </div>
    </main>
  );
}

const FOLLOWUP_WORD = {
  proposal: { proposed: "Proposed change waiting", approved: "Change approved", rejected: "Change rejected" },
  retest: { pass: "Retest passed", fail: "Retest still fails", error: "Retest had no verdict" },
  finding: { pass: "Your finding: pass", fail: "Your finding: fail" },
} as const;

/** One failed scenario in one line: severity, title, duty, agent, status, one next step. */
function FindingRow({ f, duty }: { f: TestFinding; duty: string[] }) {
  const done = [
    f.followup.proposal && FOLLOWUP_WORD.proposal[f.followup.proposal],
    f.followup.retest && FOLLOWUP_WORD.retest[f.followup.retest],
    f.followup.finding && FOLLOWUP_WORD.finding[f.followup.finding],
  ].filter(Boolean) as string[];
  return (
    <li className="grid gap-x-6 gap-y-2 px-5 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={f.severity as "critical"}>{f.severity}</Badge>
          <span className="type-mono text-xs text-ink-faint">{f.caseId}</span>
          <span className="font-medium">{f.obligation ? (OBLIGATION_LABELS as Record<string, string>)[f.obligation] ?? f.obligation : "Scenario"}</span>
          <span className="text-sm text-ink-soft">· {f.agentName}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className={f.state === "new" ? "font-semibold text-fail-text" : f.state === "resolved" ? "font-semibold text-pass-text" : "font-medium text-ink-soft"}>
            {FINDING_STATE_LABEL[f.state]}{f.state === "recurring" ? ` — ${f.streak} runs in a row` : ""}
          </span>
          {duty.length > 0 && <span className="text-ink-faint">· {duty.slice(0, 2).join(", ")}</span>}
          {done.map((d) => <span key={d} className="text-ink-soft">· {d}</span>)}
        </p>
      </div>
      <Link href={f.next.href} className="text-sm font-medium underline-offset-2 hover:underline md:text-right">{f.next.label} →</Link>
    </li>
  );
}
