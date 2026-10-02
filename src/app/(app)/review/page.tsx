import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { LENSES, type Lens } from "../runs/[id]/lenses.ts";
import type { CaseRow } from "../runs/[id]/case-table.tsx";
import { noVerdictRow, repairFor, retryWords, type Repair } from "@/lib/evidence/repair.ts";
import { testFindings, FINDING_STATE_LABEL, type FindingRun, type FindingState, type Followup, type CaseStatus, type TestFinding } from "@/lib/review/findings.ts";
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
const STATES: Array<{ key: FindingState | "open"; label: string }> = [
  { key: "open", label: "Open" },
  { key: "new", label: "New since last run" },
  { key: "recurring", label: "Recurring" },
  { key: "not_comparable", label: "Not comparable" },
  { key: "resolved", label: "Resolved" },
];

export default async function ReviewPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; agent?: string; severity?: string }>;
}) {
  const filter = await searchParams;
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
  const stateFilter = STATES.some((x) => x.key === filter.state) ? (filter.state as FindingState | "open") : "open";
  const findings = allFindings.filter((f) =>
    (stateFilter === "open" ? f.state !== "resolved" : f.state === stateFilter) &&
    (!filter.agent || f.agentId === filter.agent) &&
    (!filter.severity || f.severity === filter.severity));
  const stateCount = (k: FindingState | "open") => allFindings.filter((f) =>
    (k === "open" ? f.state !== "resolved" : f.state === k) && (!filter.agent || f.agentId === filter.agent) && (!filter.severity || f.severity === filter.severity)).length;
  const findingAgents = [...new Map(allFindings.map((f) => [f.agentId, f.agentName])).entries()];
  const hrefWith = (over: Record<string, string | undefined>) => {
    const q = new URLSearchParams();
    const next = { state: filter.state, agent: filter.agent, severity: filter.severity, ...over };
    for (const [k, v] of Object.entries(next)) if (v && !(k === "state" && v === "open")) q.set(k, v);
    return `/review${q.size ? `?${q}` : ""}#findings`;
  };

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

  return (
    <main className="w-full py-8 text-ink">
      <h1 className="type-h1">Review</h1>
      <p className="mt-2 max-w-2xl type-body text-ink-soft">
        What needs a person, across your last {RECENT_RUNS} completed runs. Each number opens that run
        with the same filter applied. Nothing here is a verdict of its own — it is where to look.
      </p>

      <section id="findings" aria-labelledby="findings-heading" className="mt-8 scroll-mt-20">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="findings-heading" className="type-h2">Failed scenarios</h2>
            <p className="mt-1 max-w-2xl text-sm text-ink-soft">
              Each agent&apos;s newest run, against the previous run of the same suite version. A failure is
              tested again by every rerun, so it is never copied into a second scenario.
            </p>
          </div>
          <nav aria-label="Filter by state" className="flex flex-wrap gap-1.5">
            {STATES.map((x) => (
              <Link
                key={x.key}
                href={hrefWith({ state: x.key })}
                aria-current={stateFilter === x.key ? "true" : undefined}
                className={`novera-press rounded-full border px-3 py-1 text-xs font-medium ${stateFilter === x.key ? "border-ink bg-ink text-on-ink" : "border-line-strong bg-surface text-ink-soft hover:text-ink"}`}
              >
                {x.label} <span className="tnum">{stateCount(x.key)}</span>
              </Link>
            ))}
          </nav>
        </div>
        {(findingAgents.length > 1 || filter.agent || filter.severity) && (
          <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-soft">
            <span className="text-ink-faint">Agent:</span>
            <Link href={hrefWith({ agent: undefined })} className={!filter.agent ? "font-semibold text-ink" : "underline underline-offset-2"}>All</Link>
            {findingAgents.map(([id, name]) => (
              <Link key={id} href={hrefWith({ agent: id })} className={filter.agent === id ? "font-semibold text-ink" : "underline underline-offset-2"}>{name}</Link>
            ))}
            <span className="ml-2 text-ink-faint">Severity:</span>
            {["critical", "high", "medium", "low"].map((sev) => (
              <Link key={sev} href={hrefWith({ severity: filter.severity === sev ? undefined : sev })} className={filter.severity === sev ? "font-semibold text-ink" : "underline underline-offset-2"}>{sev}</Link>
            ))}
          </p>
        )}
        {!runs?.length ? (
          <div className="mt-4">
            <EmptyState title="No completed runs yet">When a run finishes, every failed scenario is listed here with its next step.</EmptyState>
          </div>
        ) : findings.length === 0 ? (
          <p className="mt-4 rounded-panel border border-line bg-surface px-4 py-6 text-center text-sm text-ink-soft">
            {stateFilter === "open" ? "No failed scenario in any agent's newest run." : "Nothing in this state."}
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-line overflow-hidden rounded-shell border border-line bg-surface shadow-card">
            {findings.map((f) => <FindingRow key={f.runCaseId} f={f} />)}
          </ul>
        )}
      </section>

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

      <Reveal className="mt-10">
        <h2 id="decisions" className="type-h3 scroll-mt-20">Waiting for your decision</h2>
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
                    <Link href={`/runs/${p.run_id}?case=${p.case_id}`} className="underline underline-offset-2">{p.case_id}</Link>
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
        <h2 id="repair" className="type-h3 scroll-mt-20">Evidence needing repair</h2>
        <p className="mt-1 max-w-2xl text-sm text-ink-soft">
          Scenarios with no verdict, grouped by why. None is a failure of your agent&apos;s behaviour, and none is
          fixed by editing the policy unless it says so.
        </p>
        {!repairGroups.length ? (
          <p className="mt-3 text-sm text-ink-soft">
            {runs?.length ? `Every scenario in the last ${perRun.length} completed run${perRun.length === 1 ? "" : "s"} reached a verdict.` : "Nothing yet: no completed runs."}
          </p>
        ) : (
          <ul className="mt-3 space-y-3">
            {repairGroups.map(({ repair, items }) => (
              <li key={repair.reason}>
                <Card className="p-4">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                    {repair.label}
                    <Badge tone="error">{items.length}</Badge>
                    <span className="text-xs font-normal text-ink-faint">for {repair.owner}</span>
                  </p>
                  <p className="mt-1 text-sm text-ink-soft">{repair.happened}</p>
                  <p className="mt-2 text-sm"><span className="font-medium">Next:</span> {repair.next}</p>
                  <p className="mt-1 text-xs text-ink-faint">{retryWords(repair)}</p>
                  <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-sm">
                    {items.slice(0, 12).map((i) => (
                      <li key={`${i.runId}-${i.caseId}`}>
                        <Link href={`/runs/${i.runId}?lens=noverdict&case=${i.caseId}`} className="underline underline-offset-2">
                          {i.caseId}
                        </Link>
                        <span className="text-ink-faint"> · {i.agent}</span>
                      </li>
                    ))}
                    {items.length > 12 && <li className="text-ink-faint">and {items.length - 12} more</li>}
                  </ul>
                </Card>
              </li>
            ))}
          </ul>
        )}
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

const FOLLOWUP_WORD = {
  proposal: { proposed: "Proposed change waiting", approved: "Change approved", rejected: "Change rejected" },
  retest: { pass: "Retest passed", fail: "Retest still fails", error: "Retest had no verdict" },
  finding: { pass: "Your finding: pass", fail: "Your finding: fail" },
} as const;

/** One failed scenario: what it is, how it stands against last time, what was done, what next. */
function FindingRow({ f }: { f: TestFinding }) {
  const at = `/runs/${f.runId}?case=${encodeURIComponent(f.caseId)}`;
  const done = [
    f.followup.proposal && FOLLOWUP_WORD.proposal[f.followup.proposal],
    f.followup.retest && FOLLOWUP_WORD.retest[f.followup.retest],
    f.followup.finding && FOLLOWUP_WORD.finding[f.followup.finding],
  ].filter(Boolean) as string[];
  return (
    <li className="grid gap-x-6 gap-y-3 px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-2">
          <Badge tone={f.severity as "critical"}>{f.severity}</Badge>
          <span className="type-mono text-xs text-ink-faint">{f.caseId}</span>
          <Link href={at} className="font-medium underline-offset-2 hover:underline">
            {f.obligation ? (OBLIGATION_LABELS as Record<string, string>)[f.obligation] ?? f.obligation : "Scenario"}
          </Link>
          <span className="text-sm text-ink-soft">· {f.agentName}</span>
        </p>
        <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs">
          <span className={f.state === "new" ? "font-semibold text-fail-text" : f.state === "resolved" ? "font-semibold text-pass-text" : "font-medium text-ink-soft"}>
            {FINDING_STATE_LABEL[f.state]}{f.state === "recurring" ? ` — failing ${f.streak} runs in a row` : ""}
          </span>
          {done.map((d) => <span key={d} className="text-ink-soft">· {d}</span>)}
          {done.length === 0 && f.state !== "resolved" && <span className="text-ink-faint">· nothing done yet</span>}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm md:justify-end">
        <Link href={f.next.href} className="font-medium underline-offset-2 hover:underline">{f.next.label} →</Link>
        {f.previousRunId && f.state !== "not_comparable" && (
          <Link href={`/runs/${f.runId}?compare=${f.previousRunId}`} className="text-ink-soft underline-offset-2 hover:text-ink hover:underline">Compare</Link>
        )}
        {f.state !== "resolved" && <Link href={`/agents/${f.agentId}`} className="text-ink-soft underline-offset-2 hover:text-ink hover:underline">Rerun</Link>}
      </div>
    </li>
  );
}
