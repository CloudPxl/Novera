import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { buildAttention } from "./attention.ts";
import { summariseRun } from "./summary.ts";
import { readinessOf, READINESS_LABEL, type Readiness } from "@/lib/report/readiness.ts";
import { OBLIGATION_LABELS, type ReportPayload } from "@/lib/report/payload.ts";
import { DEFAULT_RETENTION_DAYS } from "@/lib/privacy/retention.ts";
import { testFindings, FINDING_STATE_LABEL, type FindingRun, type Followup, type CaseStatus } from "@/lib/review/findings.ts";
import { Help } from "@/components/ui/help.tsx";
import { GuidePanel } from "./guide-panel.tsx";
import { redirect } from "next/navigation";
import { can, ROLES, type Role } from "@/lib/auth/permissions.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { portfolio } from "@/lib/workspaces/portfolio.ts";
import { formatWhen, zoneLabel } from "@/lib/format/when.ts";
import { nextAction } from "./next-action.ts";
import { ChannelNote, ClientStrip, GovernancePanel, NextCard, TeamCard, UpgradeCard } from "./mode-panels.tsx";

export const metadata: Metadata = { title: "Dashboard · Novera" };
export const dynamic = "force-dynamic";

/** How many completed runs feed findings and comparisons. 12 × 49 rows stays under one page of rows. */
const COMPARED_RUNS = 12;

/** A moment `days` ago, for a query's cut-off; read once per request. */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}


/** An endpoint's host: what identifies an agent to an operator in a hurry. */
function hostOf(config: unknown): string {
  const url = (config as { url?: unknown } | null)?.url;
  if (typeof url !== "string") return "no endpoint";
  try { return new URL(url).host; } catch { return "no endpoint"; }
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
  const scheduleByAgent = new Map((schedules ?? []).map((s) => [s.agent_id as string, s]));

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
  const pausedCount = (schedules ?? []).filter((s) => s.paused_at).length;
  const firstPaused = (schedules ?? []).find((s) => s.paused_at)?.agent_id as string | undefined;
  const pendingProposals = (proposals ?? []).filter((p) => p.status === "proposed").length;
  const readyCount = [...readinessByAgent.values()].filter((r) => r.state === "READY_TO_SHARE").length;
  const firstReady = [...readinessByAgent.values()].find((r) => r.state === "READY_TO_SHARE");
  const answering = agentList.filter((a) => latestProbe.has(a.id as string) && !latestProbe.get(a.id as string)!.error).length;
  const checked = agentList.filter((a) => latestProbe.has(a.id as string)).length;
  const unreachable = agentList.filter((a) => latestProbe.get(a.id as string)?.error).length;
  const activeRuns = runList.filter((r) => r.status === "queued" || r.status === "running").length;

  // Mode-specific reads, each scoped to this person's own memberships or this workspace.
  const svc = serviceClient();
  const [rows, { data: memberRows }, { count: invitesOpen }, { data: auditRows }, { count: rawReads }] = await Promise.all([
    personal && context.memberships.length === 1 ? Promise.resolve([]) : portfolio(svc, context.memberships),
    personal ? Promise.resolve({ data: null }) : svc.from("workspace_members").select("role").eq("workspace_id", workspace.id),
    personal || !can(role, "member.invite") ? Promise.resolve({ count: 0 })
      : svc.from("workspace_invitations").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id)
        .is("accepted_at", null).is("revoked_at", null).gt("expires_at", new Date().toISOString()),
    mode === "enterprise" && can(role, "audit.view")
      ? svc.from("audit_events").select("id, action, created_at, actor_id").eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(5)
      : Promise.resolve({ data: [] as Array<{ id: string; action: string; created_at: string; actor_id: string | null }> }),
    mode === "enterprise"
      ? svc.from("raw_evidence_reads").select("*", { count: "exact", head: true }).eq("workspace_id", workspace.id).gt("read_at", daysAgo(30))
      : Promise.resolve({ count: 0 }),
  ]);
  const byRole = ROLES.map((r) => [r, (memberRows ?? []).filter((m) => m.role === r).length] as [Role, number]).filter(([, n]) => n > 0);
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

  const tiles: Tile[] = [
    { label: "Needs review", value: open.length, unit: open.length === 1 ? "open finding" : "open findings", href: "/review#findings", tone: open.length ? "high" : "quiet", note: newestPerAgent.length ? "Failed scenarios in each agent's newest run" : "No completed run yet" },
    { label: "Evidence incomplete", value: noVerdictNow, unit: noVerdictNow === 1 ? "scenario without a verdict" : "scenarios without a verdict", href: "/review#repair", tone: noVerdictNow ? "medium" : "quiet", note: "Never counted as passes" },
    { label: "New regressions", value: newRegressions, unit: "newly broken", href: "/review?state=new#findings", tone: newRegressions ? "fail" : "quiet", note: "Passed in the previous comparable run" },
    { label: "Awaiting approval", value: (draftCount ?? 0) + pendingProposals, unit: `${draftCount ?? 0} ${draftCount === 1 ? "draft" : "drafts"} · ${pendingProposals} ${pendingProposals === 1 ? "proposal" : "proposals"}`, href: (draftCount ?? 0) > 0 ? "/scenarios" : "/review#decisions", tone: (draftCount ?? 0) + pendingProposals ? "medium" : "quiet", note: "Nothing enters a suite or policy unapproved" },
    { label: "Schedules paused", value: pausedCount, unit: pausedCount === 1 ? "schedule" : "schedules", href: firstPaused ? `/agents/${firstPaused}` : "/agents/new", tone: pausedCount ? "high" : "quiet", note: (schedules ?? []).length ? `${(schedules ?? []).length} active in total` : "No schedules set" },
    { label: "Reports ready", value: readyCount, unit: `of ${readinessByAgent.size} newest ${readinessByAgent.size === 1 ? "report" : "reports"}`, href: firstReady ? `/runs/${firstReady.runId}#report` : "/review", tone: "quiet", note: "Computed from the sealed document", ratio: true },
    { label: "Connections", value: answering, unit: `of ${agentList.length} answered their last check`, href: unreachable ? `/agents/${agentList.find((a) => latestProbe.get(a.id as string)?.error)?.id}` : "/settings", tone: unreachable ? "fail" : "quiet", ratio: true, note: `${checked < agentList.length ? `${agentList.length - checked} never checked · ` : ""}${entitlement.ownKey ? `grading on your ${entitlement.provider} key` : `trial grading, ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`}` },
  ];

  const CORE = new Set(["Needs review", "Evidence incomplete", "New regressions", "Reports ready"]);
  const shownTiles = personal ? tiles.filter((t) => CORE.has(t.label) || (t.value > 0 && !t.ratio) || (t.label === "Connections" && t.tone === "fail")) : tiles;

  return (
    <main className="w-full py-8 text-ink">
      <header className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4 border-b border-line pb-6">
        <div className="min-w-0">
          <p className="type-eyebrow text-ink-faint">{personal ? (context.profile.display_name ? `Hello, ${context.profile.display_name}` : "Your workspace") : mode === "agency" ? "Client workspace" : "Workspace"}</p>
          <h1 className="mt-2 type-h1 [overflow-wrap:anywhere]">{workspace.name}</h1>
          <p className="mt-1 type-body text-ink-soft">
            {user.email} · times in {zoneLabel(context.profile.timezone)} ·{" "}
            {entitlement.ownKey
              ? `Graded on your own ${entitlement.provider} key`
              : `Trial · ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`}
          </p>
        </div>
        {/* History is secondary to the work: small, on the right, never the headline. */}
        <dl className="flex gap-6 text-sm">
          {([["Agents", agentList.length], ["Completed runs", runList.filter((r) => r.status === "completed").length], ["Reports issued", reportCount ?? 0], ["In flight", activeRuns]] as const).map(([k, v]) => (
            <div key={k}>
              <dd className="text-lg font-semibold tnum">{v}</dd>
              <dt className="text-xs text-ink-faint">{k}</dt>
            </div>
          ))}
        </dl>
      </header>

      {!entitlement.canRun && (
        <div role="status" className="mt-6 rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-relaxed text-warning-text">
          {entitlement.blockedReason}{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">Connect your key</Link>.
        </div>
      )}

      {personal && <NextCard action={action} />}
      <ChannelNote channels={context.profile.channels} />

      {setupDone < setup.length && (
        <section aria-labelledby="setup-heading" className="mt-6 rounded-shell border border-line bg-surface p-5 shadow-card">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 id="setup-heading" className="type-h3">
              Getting started · {setupDone} of {setup.length}
              <Help label="Getting started">
                Four steps from nothing to a report you can hand over. Each ticks itself when it has
                actually happened. The <Link href="/guide" className="underline underline-offset-2">step-by-step guide</Link> explains each one.
              </Help>
            </h2>
            <div aria-hidden className="h-1.5 w-40 overflow-hidden rounded-full bg-sunken">
              <div className="novera-bar h-full rounded-full bg-ink" style={{ width: `${(setupDone / setup.length) * 100}%` }} />
            </div>
          </div>
          <ol className="mt-4 grid gap-2 sm:grid-cols-4">
            {setup.map((step, i) => {
              const next = !step.done && setup.slice(0, i).every((s) => s.done);
              return (
                <li key={step.label}>
                  {step.done ? (
                    <span className="flex items-center gap-2 rounded-panel border border-line bg-ground px-3 py-2.5 text-sm text-ink-faint">
                      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full bg-pass-surface text-[11px] text-pass-text">✓</span>
                      <span className="line-through">{step.label}</span><span className="sr-only"> — done</span>
                    </span>
                  ) : (
                    <Link href={step.href} className={`novera-press flex items-center gap-2 rounded-panel border px-3 py-2.5 text-sm ${next ? "border-ink bg-surface font-medium text-ink shadow-card" : "border-line text-ink-soft hover:border-line-strong hover:text-ink"}`}>
                      <span aria-hidden className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] font-semibold ${next ? "bg-ink text-on-ink" : "border border-line-strong text-ink-faint"}`}>{i + 1}</span>
                      {step.label}{next && <span className="sr-only"> — next</span>}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {/* ------------------------------------------------------------ status board */}
      <section aria-labelledby="board-heading" className="mt-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="board-heading" className="type-h2">Attention</h2>
          <Link href="/review" className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Open the review queue →</Link>
        </div>
        <ul className={`novera-stagger mt-3 grid grid-cols-2 gap-2.5 md:grid-cols-4 ${shownTiles.length > 4 ? "xl:grid-cols-7" : ""}`} data-shown="true">
          {shownTiles.map((t, i) => (
            <li key={t.label} style={{ ["--i" as string]: i }}>
              <TileLink tile={t} />
            </li>
          ))}
        </ul>
      </section>

      {attention.length > 0 && (
        <Reveal className="mt-8">
          <section aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="type-h3">Needs you</h2>
            <ul className="mt-3 divide-y divide-line overflow-hidden rounded-shell border border-line bg-surface shadow-card">
              {attention.map((item) => (
                <li key={`${item.href}-${item.text}`} className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 sm:flex-nowrap">
                  <Badge tone={item.tone}>{item.tone === "fail" ? "broken" : item.tone === "high" ? "open" : "waiting"}</Badge>
                  <p className="min-w-0 flex-1 basis-56 type-body">{item.text}</p>
                  <Link href={item.href} className="ml-auto shrink-0 text-sm font-medium text-ink underline-offset-2 hover:underline">
                    {item.action} →
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

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
      {mode === "enterprise" && context.memberships.length > 1 && <ClientStrip rows={rows} currentId={workspace.id} label="Workspaces" />}

      <div className="mt-10 grid gap-10 xl:grid-cols-[minmax(0,8fr)_minmax(0,4fr)]">
        <div className="min-w-0 space-y-10">
          {/* ------------------------------------------------------------- agents */}
          <Reveal>
            <section aria-labelledby="agents-heading">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center"><h2 id="agents-heading" className="type-h2">{personal ? (agentList.length === 1 ? "My agent" : "My agents") : "Agents"}</h2><Help label="Agents">
                  The support agents you have connected. Open one to write its policy, check its
                  connection and run the suite against it. Only test agents you own or are authorised to test.
                </Help></div>
                {can(role, "agent.write") && <Link href="/agents/new" className="text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Connect another</Link>}
              </div>
              {agentList.length > 0 ? (
                <ul className="mt-3 grid gap-3 lg:grid-cols-2">
                  {agentList.map((a) => {
                    const id = a.id as string;
                    const latest = findingRuns.find((r) => r.agentId === id);
                    const latestRow = latest ? runList.find((r) => r.id === latest.id) : undefined;
                    const summary = latestRow ? summariseRun({ status: "completed", payload: (reportByRun.get(latest!.id)?.payload as never) ?? null, scheduleId: null, apiKeyName: null }) : null;
                    const prev = latest ? findingRuns.find((r) => r.agentId === id && r.id !== latest.id && r.suiteId === latest.suiteId) : undefined;
                    const mine = findings.filter((f) => f.agentId === id);
                    const fixed = mine.filter((f) => f.state === "resolved").length;
                    const broke = mine.filter((f) => f.state === "new").length;
                    const openHere = mine.filter((f) => f.state !== "resolved").length;
                    const readiness = readinessByAgent.get(id);
                    const sched = scheduleByAgent.get(id);
                    const probe = latestProbe.get(id);
                    return (
                      <li key={id}>
                        <Card className="flex h-full flex-col p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <Link href={`/agents/${id}`} className="block truncate font-semibold underline-offset-2 hover:underline">{a.name as string}</Link>
                              <p className="truncate type-mono text-xs text-ink-faint">{hostOf(a.config)}</p>
                            </div>
                            <div className="flex shrink-0 flex-wrap justify-end gap-1">
                              {probe?.error && <Badge tone="fail">Not answering</Badge>}
                              {a.attested_at ? <Badge tone="pass">Authorised</Badge> : <Badge tone="error">No authorisation</Badge>}
                            </div>
                          </div>

                          <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                            <Fact label="Evidence">
                              {summary ? (
                                <span className="flex flex-wrap items-center gap-1.5">
                                  <Badge tone={summary.tone}>{summary.stateLabel}</Badge>
                                  {summary.band && summary.state !== "pass" && <span className="text-xs text-ink-soft">{summary.band}</span>}
                                </span>
                              ) : <span className="text-ink-faint">No completed run</span>}
                            </Fact>
                            <Fact label="Last run">
                              {latest && summary?.counts ? (
                                <Link href={`/runs/${latest.id}`} className="tnum underline-offset-2 hover:underline">
                                  {day(latest.createdAt)} · <span className="text-pass-text">{summary.counts.passed}</span>/<span className="text-fail-text">{summary.counts.failed}</span>/<span className="text-warning-text">{summary.counts.noVerdict}</span>
                                  <span className="sr-only"> passed, failed, no verdict</span>
                                </Link>
                              ) : <span className="text-ink-faint">—</span>}
                            </Fact>
                            <Fact label="Against baseline">
                              {prev ? (
                                <span className="tnum">{day(prev.createdAt)}: <span className={broke ? "font-medium text-fail-text" : ""}>{broke} new</span>, {fixed} fixed</span>
                              ) : <span className="text-ink-faint">Nothing comparable yet</span>}
                            </Fact>
                            <Fact label="Open findings">
                              {openHere ? <Link href={`/review?agent=${id}#findings`} className="tnum font-medium underline-offset-2 hover:underline">{openHere}</Link> : <span className="text-ink-faint">None</span>}
                            </Fact>
                            <Fact label="Next scheduled run">
                              {sched ? (sched.paused_at
                                ? <span className="text-high-text">Paused{sched.paused_reason ? ` — ${sched.paused_reason as string}` : ""}</span>
                                : <span className="tnum">{when(sched.next_run_at as string)} UTC</span>)
                                : <span className="text-ink-faint">No schedule</span>}
                            </Fact>
                            <Fact label="Newest report">
                              {readiness ? (
                                <Link href={`/runs/${readiness.runId}#report`} className={`underline-offset-2 hover:underline ${readiness.state === "READY_TO_SHARE" ? "text-pass-text" : "text-ink"}`}>{READINESS_LABEL[readiness.state]}</Link>
                              ) : <span className="text-ink-faint">None yet</span>}
                            </Fact>
                          </dl>

                          <div className="mt-auto flex flex-wrap gap-2 pt-4">
                            {openHere > 0 && latest && <ButtonLink href={`/runs/${latest.id}?verdict=fail`} size="sm">Review findings</ButtonLink>}
                            <ButtonLink href={`/agents/${id}`} size="sm" variant="secondary">{latest ? "Run again" : "Write policy and run"}</ButtonLink>
                          </div>
                        </Card>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-3">
                  <EmptyState title="No agents yet" action={<ButtonLink href="/agents/new">Connect an agent</ButtonLink>}>
                    Connect an agent you own, or one you have permission to test. Novera makes one
                    harmless request first so you can see the answer before running anything.
                  </EmptyState>
                </div>
              )}
            </section>
          </Reveal>

          {/* --------------------------------------------------------------- runs */}
          <Reveal>
            <section aria-labelledby="runs-heading">
              <div className="flex items-center"><h2 id="runs-heading" className="type-h2">{personal ? "My runs" : "Recent runs"}</h2><Help label="Runs">
                A run sends every scenario in a suite to one agent and grades each answer against its
                policy. The outcome is the release gate&apos;s: pass, fail, or evidence incomplete.
              </Help></div>
              {runList.length > 0 ? (
                <ul className="mt-3 divide-y divide-line overflow-hidden rounded-shell border border-line bg-surface shadow-card">
                  {runList.slice(0, 8).map((r) => {
                    const s = summariseRun({
                      status: r.status as string,
                      payload: (reportByRun.get(r.id as string)?.payload as never) ?? null,
                      scheduleId: (r.schedule_id as string | null) ?? null,
                      apiKeyName: r.api_key_id ? keyName.get(r.api_key_id as string) ?? "key" : null,
                    });
                    const regressions = regressionsOf.get(r.id as string);
                    return (
                      <li key={r.id as string} className="grid gap-x-4 gap-y-2 px-4 py-3 transition-colors hover:bg-ground sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-2">
                            <Link href={`/runs/${r.id}`} className="font-medium underline-offset-2 hover:underline">{agentName.get(r.agent_id as string) ?? "Agent"}</Link>
                            <Badge tone={s.tone} pulse={s.state === "running"}>{s.stateLabel}</Badge>
                            {s.band && s.state !== "pass" && s.state !== "running" && <span className="text-xs text-ink-soft">{s.band}</span>}
                            {(regressions ?? 0) > 0 && <Badge tone="fail">{regressions} newly broken</Badge>}
                          </div>
                          <p className="mt-1 flex flex-wrap gap-x-3 text-xs text-ink-faint">
                            <span className="tnum">{when(r.created_at as string)} UTC</span>
                            <span>{s.startedBy}</span>
                            {s.coverage && <span className="tnum">Ran {s.coverage.ran}/{s.coverage.planned} · verdict {s.coverage.verdict}/{s.coverage.planned}</span>}
                          </p>
                        </div>
                        <div className="flex items-center gap-3 sm:justify-end">
                          {s.counts && (
                            <span className="tnum text-xs text-ink-soft">
                              {s.counts.passed} passed
                              {s.counts.failed > 0 && <span className="text-fail-text"> · {s.counts.failed} failed</span>}
                              {s.counts.noVerdict > 0 && <span className="text-warning-text"> · {s.counts.noVerdict} no verdict</span>}
                            </span>
                          )}
                          {s.counts && s.counts.failed + s.counts.noVerdict > 0 ? (
                            <Link href={`/runs/${r.id}?verdict=${s.counts.failed ? "fail" : "error"}`} className="shrink-0 text-sm font-medium underline-offset-2 hover:underline">Review findings →</Link>
                          ) : (
                            <Link href={`/runs/${r.id}`} className="shrink-0 text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">Open →</Link>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-3">
                  <EmptyState title="No runs yet">
                    Once an agent is connected and a policy version is saved, run the suite to produce a report.
                  </EmptyState>
                </div>
              )}
            </section>
          </Reveal>
        </div>

        {/* ------------------------------------------------------------- side column */}
        <aside aria-label="Findings and guide" className="min-w-0 space-y-6">
          <section aria-labelledby="findings-heading" className="rounded-shell border border-line bg-surface p-4 shadow-card">
            <div className="flex items-baseline justify-between gap-2">
              <h2 id="findings-heading" className="type-h3">{personal ? "My findings" : "Open findings"}</h2>
              {open.length > 0 && <Link href="/review#findings" className="text-xs font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline">All {open.length} →</Link>}
            </div>
            {open.length === 0 ? (
              <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                {findingRuns.length ? "No failed scenario in any agent's newest run." : "Findings appear here once a run completes."}
              </p>
            ) : (
              <ul className="mt-3 space-y-2">
                {open.slice(0, 5).map((f) => (
                  <li key={f.runCaseId}>
                    <Link href={f.next.href} className="novera-lift block rounded-panel border border-line px-3 py-2.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        <Badge tone={f.severity as "critical"}>{f.severity}</Badge>
                        <span className="type-mono text-xs text-ink-faint">{f.caseId}</span>
                        <span className={`text-xs font-medium ${f.state === "new" ? "text-fail-text" : "text-ink-soft"}`}>
                          {FINDING_STATE_LABEL[f.state]}{f.state === "recurring" && f.streak > 1 ? ` · ${f.streak} runs` : ""}
                        </span>
                      </span>
                      <span className="mt-1 block truncate text-sm">{f.obligation ? (OBLIGATION_LABELS as Record<string, string>)[f.obligation] ?? f.obligation : f.agentName}</span>
                      <span className="mt-0.5 block text-xs text-ink-soft">{f.agentName} · {f.next.label} →</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {!personal && <TeamCard byRole={byRole} canInvite={can(role, "member.invite")} invitesOpen={invitesOpen ?? 0} />}
          {personal && context.memberships.length === 1 && setupDone === setup.length && <UpgradeCard />}
          <GuidePanel
            open={setupDone < setup.length}
            firstAgentId={firstAgent}
            latestRunId={runList[0]?.id as string | undefined}
          />
        </aside>
      </div>
    </main>
  );
}

interface Tile {
  label: string;
  value: number;
  unit: string;
  href: string;
  tone: "fail" | "high" | "medium" | "quiet";
  note: string;
  /** A ratio ("1 of 2") rather than a count: its zero is a figure, not "none". */
  ratio?: boolean;
}

const TILE_TONE: Record<Tile["tone"], string> = {
  fail: "border-fail-border bg-fail-surface/60",
  high: "border-high-border bg-high-surface/60",
  medium: "border-warning-border bg-warning-surface/60",
  quiet: "border-line bg-surface",
};
const VALUE_TONE: Record<Tile["tone"], string> = { fail: "text-fail-text", high: "text-high-text", medium: "text-warning-text", quiet: "text-ink" };

function TileLink({ tile }: { tile: Tile }) {
  return (
    <Link href={tile.href} className={`novera-lift flex h-full flex-col rounded-panel border p-3 ${TILE_TONE[tile.tone]}`}>
      <span className="text-xs font-medium text-ink-soft">{tile.label}</span>
      {tile.value === 0 && !tile.ratio ? (
        <span className="mt-1.5 text-2xl font-semibold text-ink-faint">None</span>
      ) : (
        <>
          <span className={`mt-1.5 text-2xl font-semibold tnum ${VALUE_TONE[tile.tone]}`}>{tile.value}</span>
          <span className="text-xs text-ink-soft">{tile.unit}</span>
        </>
      )}
      <span className="mt-auto pt-2 text-[11px] leading-snug text-ink-faint">{tile.note}</span>
    </Link>
  );
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-ink-faint">{label}</dt>
      <dd className="mt-0.5 min-w-0 [overflow-wrap:anywhere]">{children}</dd>
    </div>
  );
}
