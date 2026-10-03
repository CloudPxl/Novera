import { Help } from "@/components/ui/help.tsx";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement } from "@/lib/auth/entitlement.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { Card, Badge, EmptyState, inputClass } from "@/components/ui/primitives.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { PolicyEditor, ReprobeButton, VerificationEndpoint, ResponsePathPicker } from "./client.tsx";
import { ScheduleCard, ScheduleForm, type ScheduleView } from "./schedules.tsx";
import { summariseRun } from "../../dashboard/summary.ts";
import { OtherWorkspace } from "@/components/shell/other-workspace.tsx";
import { PageHeader, Panel, Rows, TabNav } from "@/components/ui/page.tsx";
import { formatWhen } from "@/lib/format/when.ts";
import { can } from "@/lib/auth/permissions.ts";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { scheduleState } from "@/lib/schedules/cadence.ts";

export const metadata: Metadata = { title: "Agent · Novera" };
export const dynamic = "force-dynamic";

export default async function AgentPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const { id } = await params;
  const TABS = ["overview", "policy", "runs", "schedule", "connection"] as const;
  const requested = (await searchParams).tab ?? "";
  const tab = (TABS as readonly string[]).includes(requested) ? (requested as (typeof TABS)[number]) : "overview";
  const { user, workspace, role, context } = await requireWorkspace();
  const db = await sessionClient();
  const entitlement = await workspaceEntitlement({
    client: await assertMembership(user.id, workspace.id),
    workspaceId: workspace.id,
  });

  const { data: agent } = await db
    .from("agents").select("id, workspace_id, name, kind, config, verification, attestation_text, attested_at").eq("id", id).maybeSingle();
  if (!agent) notFound();
  if (agent.workspace_id !== workspace.id) {
    const there = context.memberships.find((m) => m.workspace.id === agent.workspace_id);
    if (!there) notFound();
    return <OtherWorkspace thing="agent" workspace={there.workspace.name} workspaceId={there.workspace.id} next={`/agents/${id}`} />;
  }

  const [{ data: probes }, { data: policies }, { data: runs }, { data: suites }, { data: schedules }] = await Promise.all([
    db.from("probes").select("id, status_code, response_body, response_shape, latency_ms, error, created_at, content_expired_at")
      .eq("agent_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("policies").select("id, version, body, created_at")
      .eq("agent_id", id).order("version", { ascending: false }),
    db.from("runs").select("id, status, created_at, suite_id, schedule_id, api_key_id").eq("agent_id", id)
      .order("created_at", { ascending: false }).limit(8),
    // Newest version first within a key, so the default below is the current suite
    // rather than whichever row Postgres happened to return first.
    db.from("suites").select("id, key, version, name").neq("approval", "exploratory").order("key").order("version", { ascending: false }),
    // Cancelled schedules stay in the table for the runs that name them, not on this page.
    db.from("run_schedules")
      .select("id, suite_id, cadence, hour_utc, weekday, next_run_at, paused_at, paused_reason, cancelled_at, last_attempt_at, last_outcome")
      .eq("agent_id", id).is("cancelled_at", null).order("created_at"),
  ]);

  // Each run's outcome is read from its sealed report, as on the dashboard.
  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: runReports } = runIds.length
    ? await db.from("reports").select("run_id, payload").in("run_id", runIds)
    : { data: [] };
  const payloadOf = new Map((runReports ?? []).map((r) => [r.run_id as string, r.payload]));

  const scheduleIds = (schedules ?? []).map((s) => s.id as string);
  const { data: scheduledRuns } = scheduleIds.length
    ? await db.from("runs").select("id, status, schedule_id").in("schedule_id", scheduleIds)
        .order("created_at", { ascending: false }).limit(40)
    : { data: [] };
  const suiteLabel = (suiteId: string) => {
    const s = (suites ?? []).find((x) => x.id === suiteId);
    return s ? `${s.name as string} v${s.version as number}` : "Suite";
  };
  const scheduleViews: ScheduleView[] = (schedules ?? []).map((s) => {
    const last = (scheduledRuns ?? []).find((r) => r.schedule_id === s.id);
    return {
      id: s.id as string,
      cadence: s.cadence as ScheduleView["cadence"],
      hourUtc: s.hour_utc as number,
      weekday: s.weekday as number | null,
      suiteLabel: suiteLabel(s.suite_id as string),
      state: scheduleState({ paused_at: s.paused_at as string | null, cancelled_at: s.cancelled_at as string | null }),
      nextRunAt: s.next_run_at as string,
      pausedReason: s.paused_reason as string | null,
      lastOutcome: s.last_outcome as string | null,
      lastAttemptAt: s.last_attempt_at as string | null,
      lastRun: last ? { id: last.id as string, status: last.status as string } : null,
    };
  });
  const costNote = entitlement.ownKey
    ? "Each run grades on your own model key."
    : `Each run uses one of your trial runs (${entitlement.runsUsed} of ${entitlement.runsAllowed ?? "?"} used). When none are left, the schedule pauses and says why.`;

  const latestProbe = probes?.[0];
  const latestPolicy = policies?.[0];
  const config = agent.config as { url?: string; responsePath?: string; toolActivityPath?: string };
  const latestCompleted = (runs ?? []).find((r) => r.status === "completed");
  const latestSummary = latestCompleted ? summariseRun({ status: "completed", payload: (payloadOf.get(latestCompleted.id as string) as never) ?? null, scheduleId: null, apiKeyName: null }) : null;
  const nextSchedule = scheduleViews.find((v) => v.state !== "cancelled") ?? null;

  return (
    <main className="w-full pb-10 text-ink">
      <PageHeader
        back={{ href: "/agents", label: context.accountMode === "personal" ? "My agents" : "Agents" }}
        eyebrow={<span className="normal-case tracking-normal">{config.url}</span>}
        title={agent.name}
        status={agent.attested_at ? <Badge tone="pass">Authorisation recorded</Badge> : <Badge tone="error">No authorisation recorded</Badge>}
        action={
          !can(role, "run.start") ? undefined
          : !latestPolicy ? <ButtonLink href={`/agents/${agent.id}?tab=policy`}>Write the policy</ButtonLink>
          : !entitlement.canRun ? <ButtonLink href="/settings">Connect a key to run</ButtonLink>
          : <div className="max-w-md">
{latestPolicy && entitlement.canRun && (
                  <form action={createRun} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="agentId" value={agent.id} />
                    {(suites ?? []).length > 1 && (
                      <select
                        name="suiteId"
                        aria-label="Suite to run"
                        defaultValue={(suites ?? []).find((s) => s.key === "eu-support")?.id}
                        className="rounded-lg border border-line-strong bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-ink focus:ring-1 focus:ring-ink"
                      >
                        {(suites ?? []).map((s) => (
                          <option key={s.id as string} value={s.id as string}>
                            {s.name as string} v{s.version as number}
                          </option>
                        ))}
                      </select>
                    )}
                    <SubmitButton pendingLabel="Starting…" size="sm">
                      Run the suite
                    </SubmitButton>
                    <details className="w-full text-sm">
                      <summary className="cursor-pointer text-ink-soft hover:text-ink">What are you testing? (optional)</summary>
                      <div className="mt-2 grid gap-2 sm:grid-cols-2">
                        <label className="text-xs text-ink-soft">
                          Agent release
                          <input name="releaseId" maxLength={100} placeholder="e.g. 2026.09.3" className={`${inputClass} mt-1`} />
                        </label>
                        <label className="text-xs text-ink-soft">
                          Knowledge-base revision
                          <input name="knowledgeBaseRevision" maxLength={100} placeholder="e.g. help-centre@4f2c1a" className={`${inputClass} mt-1`} />
                        </label>
                      </div>
                      <p className="mt-2 text-xs text-ink-faint">
                        Recorded before the run starts and shown on the report as declared by you — Novera cannot see inside your deployment to confirm it.
                      </p>
                    </details>
                  </form>
                )}
          </div>
        }
      />

      <TabNav label="Agent sections" current={tab} tabs={[
        { key: "overview", label: "Overview", href: `/agents/${agent.id}` },
        { key: "policy", label: "Policy", href: `/agents/${agent.id}?tab=policy`, count: (policies ?? []).length },
        { key: "runs", label: "Runs", href: `/agents/${agent.id}?tab=runs`, count: (runs ?? []).length },
        { key: "schedule", label: "Schedule", href: `/agents/${agent.id}?tab=schedule` },
        { key: "connection", label: "Connection", href: `/agents/${agent.id}?tab=connection` },
      ]} />

      <div className="mt-6">
        {tab === "overview" && (
          <Panel>
            <Rows label="This agent at a glance">
              {[
                { k: "Connection", v: !latestProbe ? <span className="text-ink-faint">Never checked</span> : latestProbe.error ? <Badge tone="fail">Did not answer the last check</Badge> : <span>Answered in {latestProbe.latency_ms} ms · {formatWhen(latestProbe.created_at as string, context.profile)}</span>, href: `/agents/${agent.id}?tab=connection` },
                { k: "Policy", v: latestPolicy ? <span>Version {latestPolicy.version} · <span className="text-ink-soft">{String(latestPolicy.body).split("\n")[0].slice(0, 90)}{String(latestPolicy.body).length > 90 ? "…" : ""}</span></span> : <span className="text-warning-text">None yet — a run needs one</span>, href: `/agents/${agent.id}?tab=policy` },
                { k: "Latest run", v: latestSummary && latestCompleted ? <span className="flex flex-wrap items-center gap-2"><Badge tone={latestSummary.tone}>{latestSummary.stateLabel}</Badge>{latestSummary.band && latestSummary.state !== "pass" ? <span className="text-ink-soft">{latestSummary.band}</span> : null}<span className="text-ink-faint">{formatWhen(latestCompleted.created_at as string, context.profile)}</span></span> : <span className="text-ink-faint">No completed run</span>, href: latestCompleted ? `/runs/${latestCompleted.id}` : `/agents/${agent.id}?tab=runs` },
                { k: "Open findings", v: latestSummary?.counts ? <span>{latestSummary.counts.failed} failed · {latestSummary.counts.noVerdict} without a verdict</span> : <span className="text-ink-faint">—</span>, href: `/review?agent=${agent.id}` },
                { k: "Next scheduled run", v: nextSchedule ? (nextSchedule.state === "paused" ? <span className="text-high-text">Paused{nextSchedule.pausedReason ? ` — ${nextSchedule.pausedReason}` : ""}</span> : <span>{formatWhen(nextSchedule.nextRunAt, context.profile)}</span>) : <span className="text-ink-faint">No schedule</span>, href: `/agents/${agent.id}?tab=schedule` },
              ].map((row) => (
                <li key={row.k}>
                  <Link href={row.href} className="grid gap-x-6 gap-y-0.5 px-5 py-3.5 text-sm transition-colors hover:bg-ground sm:grid-cols-[10rem_minmax(0,1fr)_auto] sm:items-center">
                    <span className="text-xs font-medium text-ink-faint">{row.k}</span>
                    <span className="min-w-0">{row.v}</span>
                    <span aria-hidden className="hidden text-ink-faint sm:inline">→</span>
                  </Link>
                </li>
              ))}
            </Rows>
          </Panel>
        )}
        {tab === "runs" && (
            <section>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Runs</h2><Help label="Running the suite">Runs the chosen suite version against this agent with the current policy. The newest version is selected. Each run produces a dated report when it finishes.</Help></div>
              </div>

              {!entitlement.canRun && (
                <div
                  role="status"
                  className="mt-3 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-relaxed text-warning-text"
                >
                  {entitlement.blockedReason}{" "}
                  <Link href="/settings" className="font-medium underline underline-offset-2">
                    Connect your key
                  </Link>
                  .
                </div>
              )}

              {runs && runs.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {runs.map((r) => {
                    const sum = summariseRun({ status: r.status as string, payload: (payloadOf.get(r.id as string) as never) ?? null, scheduleId: (r.schedule_id as string | null) ?? null, apiKeyName: r.api_key_id ? "key" : null });
                    return (
                    <li key={r.id}>
                      <Link href={`/runs/${r.id}`} className="block">
                        <Card interactive className="flex items-center justify-between px-4 py-3">
                          <div>
                            <p className="font-mono text-xs text-ink-faint">{r.id.slice(0, 8)}</p>
                            <p className="mt-0.5 text-xs text-ink-faint">
                              {(suites ?? []).find((s) => s.id === r.suite_id)?.name ?? "Suite"} ·{" "}
                              {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                              {r.schedule_id ? " · scheduled" : r.api_key_id ? " · started by API key" : ""}
                            </p>
                          </div>
                          <span className="flex shrink-0 flex-wrap items-center justify-end gap-2">
                            {sum.counts && (
                              <span className="tnum text-xs text-ink-soft">
                                {sum.counts.passed}/<span className="text-fail-text">{sum.counts.failed}</span>/<span className="text-warning-text">{sum.counts.noVerdict}</span>
                                <span className="sr-only"> passed, failed, no verdict</span>
                              </span>
                            )}
                            {sum.band && sum.state !== "pass" && sum.state !== "running" && <span className="text-xs text-ink-soft">{sum.band}</span>}
                            <Badge tone={sum.tone} pulse={sum.state === "running"}>{sum.stateLabel}</Badge>
                          </span>
                        </Card>
                      </Link>
                    </li>
                    );
                  })}
                </ul>
              ) : (
                <div className="mt-3">
                  <EmptyState title="No runs yet">
                    {latestPolicy
                      ? "Run the suite to produce the first report for this agent."
                      : "Save a policy version first — a run has to name what it tested against."}
                  </EmptyState>
                </div>
              )}
            </section>
        )}
        {tab === "policy" && (
            <section>
              <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Policy</h2><Help label="Policy">The rules this agent should follow. Every verdict is judged against this text. Saving creates a new version; earlier versions and the runs graded on them are kept.</Help></div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Every version is kept. Saving creates a new one — an existing version can never be
                edited, so a report always names exactly what the agent was tested against.
              </p>
              {!latestPolicy && (
                <p className="mt-2 text-sm leading-relaxed text-ink-soft">
                  Already have it written down — a refund policy, a help-centre page? Add it in the{" "}
                  <Link href="/builder" className="font-medium text-ink underline underline-offset-2">Suite Builder</Link>,
                  draft scenarios from it, and save it here word for word with one press.
                </p>
              )}
              <PolicyEditor
                agentId={agent.id}
                latest={latestPolicy ? { version: latestPolicy.version, body: latestPolicy.body } : null}
                history={(policies ?? []).map((p) => ({ version: p.version, createdAt: p.created_at }))}
              />
            </section>
        )}
        {tab === "schedule" && (
            <section>
              <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Schedule</h2><Help label="Scheduled runs">Runs the suite again on a calendar, so a change in the agent — a new model, an edited prompt — shows up in a comparison without anyone remembering to press the button. Each scheduled run is an ordinary run with its own sealed report, and says it was scheduled.</Help></div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                Re-run the suite on a calendar. Each run compares with this agent&rsquo;s previous run on the same suite.
              </p>
              {scheduleViews.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {scheduleViews.map((s) => <li key={s.id}><ScheduleCard schedule={s} /></li>)}
                </ul>
              )}
              {latestPolicy ? (
                <ScheduleForm
                  agentId={agent.id}
                  suites={(suites ?? []).map((s) => ({ id: s.id as string, label: suiteLabel(s.id as string) }))}
                  defaultSuiteId={(suites ?? []).find((s) => s.key === "eu-support")?.id as string | undefined}
                  costNote={costNote}
                />
              ) : (
                <p className="mt-3 text-sm text-ink-soft">Save a policy version first — every scheduled run is graded against it.</p>
              )}
            </section>
        )}
        {tab === "connection" && (
          <div className="space-y-10">
            <section>
              <div className="flex items-center justify-between">
                <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Connection</h2><Help label="Connection">Where Novera sends each scenario, and the last time it checked your agent answered. Re-check it after changing the agent&rsquo;s address.</Help></div>
                <ReprobeButton agentId={agent.id} />
              </div>
              {latestProbe ? (
                <Card className="mt-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    {latestProbe.error ? (
                      <Badge tone="fail">No answer</Badge>
                    ) : (
                      <Badge tone="pass">Answered in {latestProbe.latency_ms}ms</Badge>
                    )}
                    <span className="text-xs text-ink-faint">
                      {new Date(latestProbe.created_at).toISOString().slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                    {latestProbe.error ?? (latestProbe.content_expired_at
                      ? "The reply in this receipt was cleared 90 days after it was taken. Re-check the connection for a fresh one."
                      : latestProbe.response_body?.slice(0, 400))}
                  </p>
                  <p className="mt-2 text-xs text-ink-faint">
                    This is the saved receipt of one harmless request. Read it before trusting a full run.
                  </p>

                  {/* Absent on probes recorded before the shape was kept, and on agents
                      that are not HTTP. A receipt without one simply shows less, rather
                      than showing an empty picker. */}
                  {latestProbe.response_shape && (
                    <ResponsePathPicker
                      agentId={agent.id}
                      current={config.responsePath ?? ""}
                      currentTools={config.toolActivityPath ?? null}
                      shape={latestProbe.response_shape as {
                        paths: Array<{ path: string; preview: string; length: number }>;
                        replyPaths: string[];
                        toolPaths: string[];
                      }}
                    />
                  )}
                </Card>
              ) : (
                <p className="mt-3 text-sm text-ink-soft">No connection receipt yet.</p>
              )}
            </section>
            <section>
              <div className="flex items-center"><h2 className="text-lg font-semibold tracking-tight">Verifying what the agent does</h2><Help label="Read-back">Optional. A read-only address in your own system Novera can check to confirm an action the agent claims, such as a refund. Without it, such claims are reported as not verified — never as passed.</Help></div>
              <p className="mt-1 text-sm leading-relaxed text-ink-soft">
                A tool call is not an effect, and the agent saying it refunded an order is
                not a refund. This is where Novera goes to find out.
              </p>
              <VerificationEndpoint
                agentId={agent.id}
                current={(agent.verification as { url?: string; authHeaderName?: string } | null) ?? null}
              />
            </section>
          </div>
        )}
      </div>
    </main>
  );
}
