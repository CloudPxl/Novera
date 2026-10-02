import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Badge } from "@/components/ui/primitives.tsx";
import { buildAttention } from "./attention.ts";
import { summariseRun } from "./summary.ts";
import { readinessOf, READINESS_LABEL, type Readiness } from "@/lib/report/readiness.ts";
import { OBLIGATION_LABELS, type ReportPayload } from "@/lib/report/payload.ts";
import { DEFAULT_RETENTION_DAYS } from "@/lib/privacy/retention.ts";
import { testFindings, type FindingRun, type Followup, type CaseStatus } from "@/lib/review/findings.ts";
import { redirect } from "next/navigation";
import { can } from "@/lib/auth/permissions.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { portfolio } from "@/lib/workspaces/portfolio.ts";
import { formatWhen, zoneLabel } from "@/lib/format/when.ts";
import { nextAction } from "./next-action.ts";
import { ChannelNote, ClientStrip, GovernancePanel } from "./mode-panels.tsx";
import { AttentionList, HealthLine, Metrics, PageHeader, Panel, Rows, Section, ViewAll } from "@/components/ui/page.tsx";

export const metadata: Metadata = { title: "Dashboard · Novera" };
export const dynamic = "force-dynamic";

/** How many completed runs feed findings and comparisons. 12 × 49 rows stays under one page of rows. */
const COMPARED_RUNS = 12;

/** A moment `days` ago, for a query's cut-off; read once per request. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}


/**
 * The first screen after signing in: what needs attention now, then what exists.
 *
 * Every figure is a count of stored rows or read from a sealed report. A run in flight is
 * never described by its counts, a withheld grade is never drawn as a fail, and a status
 * tile at zero says "none" in a quiet voice rather than disappearing — the board's job is
 * to be read at a glance, and a missing tile reads as "unknown", not "clear".
 */
export default async function DashboardPage() {
  const { user, workspace, role, context } = await requireWorkspace();
  // A first visit answers three questions first; skipping them is one click (/welcome).
  if (context.profile.onboarding_status === "not_started") redirect("/welcome");
  const mode = context.accountMode;
  const personal = mode === "personal";
  const when = (iso: string) => formatWhen(iso, context.profile);
  const day = (iso: string) => formatWhen(iso, context.profile, { date: true });
  const db = await sessionClient();

  // Read through the user's own client: whatever comes back, RLS allowed.
  const weekAgo = daysAgo(7);
  const [
    { data: agents }, { data: runs }, { count: reportCount }, { data: probes }, { count: draftCount },
    { count: policyCount }, { data: reports }, { data: schedules }, { data: keys }, { data: proposals },
    { data: wsRow }, { count: failedDeliveries },
  ] = await Promise.all([
    db.from("agents").select("id, name, config, attested_at, is_production").eq("workspace_id", workspace.id).order("created_at"),
    db.from("runs").select("id, status, created_at, agent_id, suite_id, schedule_id, api_key_id").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(30),
    db.from("reports").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    // Enough recent receipts to find the latest for each agent, in one query.
    db.from("probes").select("agent_id, error, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(60),
    db.from("scenario_drafts").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "draft"),
    db.from("policies").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id),
    db.from("reports").select("run_id, payload, content_hash, expires_at, revoked_at, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(40),
    db.from("run_schedules").select("agent_id, next_run_at, paused_at, paused_reason").eq("workspace_id", workspace.id).is("cancelled_at", null),
    db.from("api_keys").select("id, name").eq("workspace_id", workspace.id),
    db.from("diagnoses").select("run_case_id, status").eq("workspace_id", workspace.id).in("status", ["proposed", "approved", "rejected"]).order("created_at", { ascending: false }).limit(200),
    db.from("workspaces").select("raw_evidence_days").eq("id", workspace.id).maybeSingle(),
    db.from("webhook_deliveries").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).eq("status", "failed").gt("created_at", weekAgo),
  ]);

  const agentList = agents ?? [];
  const runList = runs ?? [];
  const agentName = new Map(agentList.map((a) => [a.id as string, a.name as string]));
  const keyName = new Map((keys ?? []).map((k) => [k.id as string, k.name as string]));
  const reportByRun = new Map((reports ?? []).map((r) => [r.run_id as string, r]));

  // Case rows for the completed runs that feed findings and comparisons.
  const compared = runList.filter((r) => r.status === "completed").slice(0, COMPARED_RUNS);
  const comparedIds = compared.map((r) => r.id as string);
  const [{ data: caseRows }, { data: retests }, { data: reviews }] = await Promise.all([
    comparedIds.length
      ? db.from("run_cases").select("id, run_id, case_id, status, severity, obligation").in("run_id", comparedIds)
      : Promise.resolve({ data: [] as Array<Record<string, unknown>> }),
    db.from("case_retests").select("run_case_id, status, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(200),
    db.from("verdict_reviews").select("run_case_id, finding, created_at").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(200),
  ]);

  const findingRuns: FindingRun[] = compared.map((r) => ({
    id: r.id as string,
    agentId: r.agent_id as string,
    agentName: agentName.get(r.agent_id as string) ?? "Agent",
    suiteId: r.suite_id as string,
    createdAt: r.created_at as string,
    cases: new Map((caseRows ?? []).filter((c) => c.run_id === r.id).map((c) => [c.case_id as string, {
      runCaseId: c.id as string, status: c.status as CaseStatus, severity: c.severity as string, obligation: (c.obligation as string | null) ?? null,
    }])),
  }));
  const followups = new Map<string, Followup>();
  const touch = (id: string) => { const f = followups.get(id) ?? {}; followups.set(id, f); return f; };
  for (const d of proposals ?? []) { const f = touch(d.run_case_id as string); f.proposal ??= d.status as Followup["proposal"]; }
  for (const t of retests ?? []) { const f = touch(t.run_case_id as string); f.retest ??= t.status as CaseStatus; }
  for (const v of reviews ?? []) { const f = touch(v.run_case_id as string); f.finding ??= v.finding as "pass" | "fail"; }
  const findings = testFindings(findingRuns, followups);
  const open = findings.filter((f) => f.state !== "resolved");

  // Newly broken per run: failing now, passing in the previous run of the same agent and suite.
  const regressionsOf = new Map<string, number>();
  for (const [i, r] of findingRuns.entries()) {
    const prev = findingRuns.slice(i + 1).find((p) => p.agentId === r.agentId && p.suiteId === r.suiteId);
    if (!prev) continue;
    let n = 0;
    for (const [id, c] of r.cases) if (c.status === "fail" && prev.cases.get(id)?.status === "pass") n++;
    regressionsOf.set(r.id, n);
  }

  // Per agent: newest completed run, its report's readiness, its schedule, its connection.
  const latestProbe = new Map<string, { error: string | null }>();
  for (const p of probes ?? []) {
    if (!latestProbe.has(p.agent_id as string)) latestProbe.set(p.agent_id as string, { error: (p.error as string | null) ?? null });
  }
  const newestReportRuns = new Map<string, string>();
  for (const r of runList) {
    if (r.status === "completed" && reportByRun.has(r.id as string) && !newestReportRuns.has(r.agent_id as string)) {
      newestReportRuns.set(r.agent_id as string, r.id as string);
    }
  }
  const readinessByAgent = new Map<string, { state: Readiness; runId: string; gap: string | null }>();
  for (const [agentId, runId] of newestReportRuns) {
    const rep = reportByRun.get(runId)!;
    // Findings recorded after the report was sealed, which a client has not been shown.
    const caseIds = new Set([...(findingRuns.find((f) => f.id === runId)?.cases.values() ?? [])].map((c) => c.runCaseId));
    const undisclosed = (reviews ?? []).filter((v) => caseIds.has(v.run_case_id as string) && (v.created_at as string) > (rep.created_at as string)).length;
    const r = readinessOf({
      report: { payload: rep.payload as unknown as ReportPayload, content_hash: rep.content_hash as string, expires_at: rep.expires_at as string, revoked_at: (rep.revoked_at as string | null) ?? null },
      undisclosedReviews: undisclosed,
    });
    readinessByAgent.set(agentId, { state: r.state, runId, gap: r.checks.find((c) => c.result === "gap")?.detail ?? null });
  }

  // The existing, tested "needs you" sentences.
  const retentionDays = (wsRow?.raw_evidence_days as number | null) ?? DEFAULT_RETENTION_DAYS;
  const { count: expiringSoon } = await db.from("run_cases").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id)
    .not("response_text", "is", null).is("raw_expired_at", null).lt("created_at", daysAgo(retentionDays - 7));
  const outcomes = new Map<string, { pass: number; fail: number; error: number }>();
  for (const r of findingRuns) {
    const o = { pass: 0, fail: 0, error: 0 };
    for (const c of r.cases.values()) o[c.status] += 1;
    outcomes.set(r.id, o);
  }
  const notReady = [...readinessByAgent.entries()].find(([, r]) => r.state !== "READY_TO_SHARE" && r.state !== "EXPIRED" && r.state !== "REVOKED");
  const attention = buildAttention({
    agents: agentList.map((a) => ({ id: a.id as string, name: a.name as string, attested_at: (a.attested_at as string | null) ?? null })),
    runs: runList.slice(0, 6).map((r) => ({ id: r.id as string, status: r.status as string, agent_id: r.agent_id as string })),
    outcomes,
    latestProbe,
    draftCount: draftCount ?? 0,
    pausedSchedules: (schedules ?? []).filter((s) => s.paused_at).map((s) => ({ agent_id: s.agent_id as string, reason: (s.paused_reason as string | null) ?? null })),
    proposalCount: (proposals ?? []).filter((p) => p.status === "proposed").length,
    reportNotReady: notReady ? { runId: notReady[1].runId, agentId: notReady[0], label: READINESS_LABEL[notReady[1].state], gap: notReady[1].gap } : null,
    repliesExpiringSoon: expiringSoon ?? 0,
    failedDeliveries: failedDeliveries ?? 0,
  });

  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  // The first-run checklist, from stored rows only.
  const firstAgent = agentList[0]?.id as string | undefined;
  const setup = [
    { done: agentList.length > 0, label: "Connect an agent", href: "/agents/new" },
    { done: (policyCount ?? 0) > 0, label: "Write its policy", href: firstAgent ? `/agents/${firstAgent}` : "/agents/new" },
    { done: runList.length > 0, label: "Run the suite", href: firstAgent ? `/agents/${firstAgent}` : "/agents/new" },
    { done: (reportCount ?? 0) > 0, label: "Open the report", href: runList[0] ? `/runs/${runList[0].id}` : "/guide" },
  ];
  const setupDone = setup.filter((s) => s.done).length;

  // The status board.
  const newestPerAgent = agentList.map((a) => findingRuns.find((r) => r.agentId === a.id)).filter(Boolean) as FindingRun[];
  const noVerdictNow = newestPerAgent.reduce((n, r) => n + [...r.cases.values()].filter((c) => c.status === "error").length, 0);
  const newRegressions = open.filter((f) => f.state === "new").length;
  const readyCount = [...readinessByAgent.values()].filter((r) => r.state === "READY_TO_SHARE").length;
  const firstReady = [...readinessByAgent.values()].find((r) => r.state === "READY_TO_SHARE");

  // Mode-specific reads, each scoped to this person's own memberships or this workspace.
  const svc = serviceClient();
  const [rows, { data: auditRows }, { count: rawReads }] = await Promise.all([
    personal && context.memberships.length === 1 ? Promise.resolve([]) : portfolio(svc, context.memberships),
    mode === "enterprise" && can(role, "audit.view")
      ? svc.from("audit_events").select("id, action, created_at, actor_id").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] as Array<{ id: string; action: string; created_at: string; actor_id: string | null }> }),
    mode === "enterprise"
      ? svc.from("raw_evidence_reads").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).gt("read_at", daysAgo(30))
      : Promise.resolve({ count: 0 }),
  ]);
  const actorNames = new Map<string, string>();
  for (const id of new Set((auditRows ?? []).map((e) => e.actor_id).filter(Boolean) as string[])) {
    const { data: p } = await svc.from("user_profiles").select("display_name").eq("user_id", id).maybeSingle();
    actorNames.set(id, (p?.display_name as string | null) ?? (id === user.id ? "You" : "A member"));
  }
  const top = open[0];
  const action = nextAction({
    goal: context.profile.primary_goal, accountMode: mode, workspaces: context.memberships.length,
    hasAgent: agentList.length > 0, firstAgentId: (agentList[0]?.id as string | undefined) ?? null,
    hasPolicy: (policyCount ?? 0) > 0, hasRun: runList.length > 0,
    runInFlight: (runList.find((r) => r.status === "queued" || r.status === "running")?.id as string | undefined) ?? null,
    topFinding: top ? { href: top.next.href, caseId: top.caseId, label: `${top.obligation ? (OBLIGATION_LABELS as Record<string, string>)[top.obligation] ?? top.obligation : "A scenario"} failed on ${top.agentName}. ${top.next.label}.` } : null,
    noVerdict: noVerdictNow, readyRunId: firstReady?.runId ?? null,
    blockedReason: entitlement.canRun ? null : entitlement.blockedReason,
    may: { connect: can(role, "agent.write"), run: can(role, "run.start"), review: can(role, "workspace.view") },
  });

  // ------------------------------------------------------------------ Decide
  // One sentence for the workspace's state, from its stored rows, worst first.
  const latestOutcomes = newestPerAgent.map((r) => summariseRun({ status: "completed", payload: (reportByRun.get(r.id)?.payload as never) ?? null, scheduleId: null, apiKeyName: null }));
  const health: { tone: "pass" | "fail" | "warning" | "neutral" | "info"; title: string; detail: string } =
    runList.length === 0
      ? { tone: "neutral", title: "No runs yet", detail: agentList.length ? "Run the suite against your agent to get its first verdicts." : "Connect an agent and run the suite to get its first verdicts." }
      : open.length > 0 || latestOutcomes.some((o) => o.state === "fail")
        ? { tone: "fail", title: "Findings need review", detail: `${open.length} failed ${open.length === 1 ? "scenario" : "scenarios"} in ${newestPerAgent.length === 1 ? "the latest run" : "the latest runs"}${newRegressions ? `, ${newRegressions} newly broken` : ""}.` }
        : noVerdictNow > 0 || latestOutcomes.some((o) => o.state === "incomplete")
          ? { tone: "warning", title: "Evidence incomplete", detail: `${noVerdictNow} ${noVerdictNow === 1 ? "scenario has" : "scenarios have"} no verdict. None is counted as a pass, so no grade is given until they are settled.` }
          : newestPerAgent.length === 0
            ? { tone: "info", title: "A run is in progress", detail: "Its result appears when every scenario is recorded — never before." }
            : readyCount > 0
              ? { tone: "pass", title: "All comparable checks passed", detail: `${readyCount === 1 ? "The newest report is" : `${readyCount} newest reports are`} ready to share.` }
              : { tone: "pass", title: "All comparable checks passed", detail: "The newest report is ready for internal review before it is shared." };
  const latestRun = runList.find((r) => r.status === "completed");
  const latestSum = latestRun ? summariseRun({ status: "completed", payload: (reportByRun.get(latestRun.id as string)?.payload as never) ?? null, scheduleId: null, apiKeyName: null }) : null;

  // At most five things that need someone, each linking to where it is resolved.
  const attentionItems = [
    ...(!entitlement.canRun ? [{ text: entitlement.blockedReason ?? "Runs cannot start.", href: "/settings", action: "Connect a key", tone: "fail" as const }] : []),
    ...attention.map((i) => ({ text: i.text, href: i.href, action: i.action, tone: i.tone })),
  ];

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        eyebrow={personal ? workspace.name : mode === "agency" ? "Client workspace" : "Workspace"}
        title={personal ? (context.profile.display_name ? `Hello, ${context.profile.display_name}` : "Overview") : workspace.name}
        description={<>Times in {zoneLabel(context.profile.timezone)} · {entitlement.ownKey ? `graded on your ${entitlement.provider} key` : `trial, ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`}</>}
        action={<ButtonLink href={action.href}>{action.label}</ButtonLink>}
      />

      <ChannelNote channels={context.profile.channels} />

      <Panel className="mt-2">
        <HealthLine tone={health.tone} title={health.title} detail={health.detail} />
        <div className="border-t border-line">
          <Metrics items={[
            {
              label: "Latest run",
              value: latestSum ? <Badge tone={latestSum.tone}>{latestSum.stateLabel}</Badge> : <span className="text-ink-faint">None yet</span>,
              note: latestRun ? `${agentName.get(latestRun.agent_id as string) ?? "Agent"} · ${day(latestRun.created_at as string)}${latestSum?.band && latestSum.state !== "pass" ? ` · ${latestSum.band}` : ""}` : undefined,
              href: latestRun ? `/runs/${latestRun.id}` : undefined,
            },
            { label: "Open findings", value: open.length, note: newRegressions ? `${newRegressions} newly broken` : open.length ? "None new since last run" : "Nothing failing", href: open.length ? "/review#findings" : undefined },
            { label: "Reports ready", value: <>{readyCount}<span className="text-sm font-normal text-ink-faint"> of {readinessByAgent.size}</span></>, note: "Computed from each sealed report", href: "/reports" },
          ]} />
        </div>
      </Panel>

      <Section id="attention" title="Needs attention" action={attentionItems.length ? <ViewAll href="/review">Review queue</ViewAll> : undefined}>
        {attentionItems.length ? (
          <AttentionList items={attentionItems} more={{ href: "/review", count: attentionItems.length }} />
        ) : (
          <p className="rounded-shell border border-line bg-surface px-5 py-4 text-sm text-ink-soft">Nothing needs you right now.</p>
        )}
      </Section>

      {mode === "agency" && <ClientStrip rows={rows} currentId={workspace.id} label="Clients" />}
      {mode === "enterprise" && (
        <GovernancePanel
          events={(auditRows ?? []).map((e) => ({ id: e.id as string, action: e.action as string, created_at: e.created_at as string, who: e.actor_id ? actorNames.get(e.actor_id as string) ?? "A member" : "Novera" }))}
          retentionDays={retentionDays}
          rawReads={rawReads ?? 0}
          funding={entitlement.ownKey ? `The workspace's own ${entitlement.provider} key` : "Novera's trial allowance"}
          canAudit={can(role, "audit.view")}
        />
      )}

      <Section id="recent" title="Recent activity" action={runList.length > 5 ? <ViewAll href="/runs">All runs</ViewAll> : undefined}>
        {runList.length === 0 ? (
          <p className="rounded-shell border border-line bg-surface px-5 py-4 text-sm text-ink-soft">No runs yet.</p>
        ) : (
          <Panel>
            <Rows label="Recent runs">
              {runList.slice(0, 5).map((r) => {
                const s = summariseRun({
                  status: r.status as string,
                  payload: (reportByRun.get(r.id as string)?.payload as never) ?? null,
                  scheduleId: (r.schedule_id as string | null) ?? null,
                  apiKeyName: r.api_key_id ? keyName.get(r.api_key_id as string) ?? "key" : null,
                });
                const regressions = regressionsOf.get(r.id as string);
                return (
                  <li key={r.id as string}>
                    <Link href={`/runs/${r.id}`} className="grid gap-x-4 gap-y-1 px-5 py-3 transition-colors hover:bg-ground sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{agentName.get(r.agent_id as string) ?? "Agent"}</span>
                          <Badge tone={s.tone} pulse={s.state === "running"}>{s.stateLabel}</Badge>
                          {(regressions ?? 0) > 0 && <span className="text-xs font-medium text-fail-text">{regressions} newly broken</span>}
                        </span>
                        <span className="mt-0.5 block text-xs text-ink-faint">{when(r.created_at as string)} · {s.startedBy}</span>
                      </span>
                      {s.counts ? (
                        <span className="text-xs text-ink-soft tnum">
                          {s.counts.passed} passed{s.counts.failed > 0 && <span className="text-fail-text"> · {s.counts.failed} failed</span>}
                          {s.counts.noVerdict > 0 && <span className="text-warning-text"> · {s.counts.noVerdict} no verdict</span>}
                        </span>
                      ) : <span className="text-xs text-ink-faint">{s.state === "running" ? "In progress" : "Not sealed"}</span>}
                    </Link>
                  </li>
                );
              })}
            </Rows>
          </Panel>
        )}
      </Section>

      {setupDone < setup.length && (
        <Section id="setup" title="Continue setup" action={<ViewAll href="/guide">How Novera works</ViewAll>}>
          <Panel>
            <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
              <p className="text-sm text-ink-soft"><span className="font-medium text-ink">{setupDone} of {setup.length} done.</span> Each step ticks itself when it has actually happened.</p>
              <div aria-hidden className="h-1.5 w-40 overflow-hidden rounded-full bg-sunken">
                <div className="novera-bar h-full rounded-full bg-ink" style={{ width: `${(setupDone / setup.length) * 100}%` }} />
              </div>
            </div>
            <ol className="grid border-t border-line sm:grid-cols-4">
              {setup.map((step, i) => {
                const next = !step.done && setup.slice(0, i).every((x) => x.done);
                return (
                  <li key={step.label} className="border-line px-5 py-3 text-sm sm:border-l sm:first:border-l-0">
                    {step.done ? (
                      <span className="text-ink-faint"><span aria-hidden>✓ </span><span className="line-through">{step.label}</span><span className="sr-only"> — done</span></span>
                    ) : (
                      <Link href={step.href} className={next ? "font-medium text-ink underline underline-offset-2" : "text-ink-soft hover:text-ink"}>{i + 1}. {step.label}{next && <span className="sr-only"> — next</span>}</Link>
                    )}
                  </li>
                );
              })}
            </ol>
          </Panel>
        </Section>
      )}

      {personal && context.memberships.length === 1 && setupDone === setup.length && (
        <p className="mt-10 text-sm text-ink-soft">
          Working with a team, or for clients? <Link href="/settings/profile#mode-heading" className="font-medium text-ink underline underline-offset-2">Change how you use Novera</Link> — nothing you have moves.
        </p>
      )}
    </main>
  );
}
