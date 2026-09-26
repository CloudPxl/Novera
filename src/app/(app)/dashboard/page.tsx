import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement, TRIAL_RUN_LIMIT } from "@/lib/auth/entitlement.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { buildAttention } from "./attention.ts";
import { Help } from "@/components/ui/help.tsx";

export const metadata: Metadata = { title: "Dashboard · Novera" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();

  // Read through the user's own client: whatever comes back, RLS allowed.
  const [{ data: agents }, { data: runs }, { count: reportCount }, { data: probes }, { count: draftCount }, { count: policyCount }] =
    await Promise.all([
      db.from("agents").select("id, name, config, attested_at").order("created_at"),
      db.from("runs").select("id, status, created_at, agent_id").order("created_at", { ascending: false }).limit(6),
      db.from("reports").select("*", { count: "exact", head: true }),
      // Enough recent receipts to find the latest for each agent. One query rather
      // than one per agent: a dashboard that costs a round trip per row is a
      // dashboard that gets slower every time the workspace succeeds.
      db.from("probes").select("agent_id, error, created_at").order("created_at", { ascending: false }).limit(60),
      db.from("scenario_drafts").select("*", { count: "exact", head: true }).eq("status", "draft"),
      db.from("policies").select("*", { count: "exact", head: true }),
    ]);

  // The first-run checklist, from stored rows only: a step is done when the row that
  // proves it exists, never because a page was visited.
  const firstAgent = agents?.[0]?.id as string | undefined;
  const setup = [
    { done: (agents ?? []).length > 0, label: "Connect the agent you want to test", href: "/agents/new" },
    { done: (policyCount ?? 0) > 0, label: "Write the policy it should follow", href: firstAgent ? `/agents/${firstAgent}` : "/agents/new" },
    { done: (runs ?? []).length > 0, label: "Run the suite against it", href: firstAgent ? `/agents/${firstAgent}` : "/agents/new" },
    { done: (reportCount ?? 0) > 0, label: "Open the report a finished run produces", href: (runs ?? [])[0] ? `/runs/${runs![0].id}` : "/guide" },
  ];
  const setupDone = setup.filter((s) => s.done).length;

  const agentNames = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const completed = (runs ?? []).filter((r) => r.status === "completed").length;

  // What each run actually found. One query for every run on the page, reduced here —
  // a run row that says only "completed" withholds the single fact the operator came
  // for, and asking per row would be six queries to tell them.
  const runIds = (runs ?? []).map((r) => r.id as string);
  const { data: caseRows } = runIds.length
    ? await db.from("run_cases").select("run_id, status").in("run_id", runIds)
    : { data: [] };

  const outcomes = new Map<string, { pass: number; fail: number; error: number }>();
  for (const c of caseRows ?? []) {
    const id = c.run_id as string;
    const o = outcomes.get(id) ?? { pass: 0, fail: 0, error: 0 };
    o[c.status as "pass" | "fail" | "error"] += 1;
    outcomes.set(id, o);
  }

  const latestProbe = new Map<string, { error: string | null }>();
  for (const p of probes ?? []) {
    if (!latestProbe.has(p.agent_id as string)) {
      latestProbe.set(p.agent_id as string, { error: (p.error as string | null) ?? null });
    }
  }

  // Extracted so it can be tested: the rules about what deserves someone's attention
  // are the valuable part, and inside a server component nothing could reach them.
  const attention = buildAttention({
    agents: (agents ?? []).map((a) => ({
      id: a.id as string,
      name: a.name as string,
      attested_at: (a.attested_at as string | null) ?? null,
    })),
    runs: (runs ?? []).map((r) => ({
      id: r.id as string,
      status: r.status as string,
      agent_id: r.agent_id as string,
    })),
    outcomes,
    latestProbe,
    draftCount: draftCount ?? 0,
  });

  const admin = await assertMembership(user.id, workspace.id);
  const entitlement = await workspaceEntitlement({ client: admin, workspaceId: workspace.id });

  return (
    <main className="w-full max-w-4xl py-8 text-ink">
      {/* The identity block only. Connect / Settings / Inbox / Sign out moved to the
          top bar in the shell — four buttons repeated on every page was four chances
          to render them differently. */}
      <header className="border-b border-line pb-6">
        <p className="type-pill text-ink-faint">Workspace</p>
        <h1 className="mt-2 type-h1">{workspace.name}</h1>
        <p className="mt-1 type-body text-ink-soft">
          {user.email} ·{" "}
          {entitlement.ownKey
            ? `Graded on your own ${entitlement.provider} key`
            : `Trial · ${Math.max(0, TRIAL_RUN_LIMIT - entitlement.runsUsed)} of ${TRIAL_RUN_LIMIT} runs left`}
        </p>
      </header>

      {!entitlement.canRun && (
        <div
          role="status"
          className="mt-6 rounded-xl border border-warning-border bg-warning-surface px-4 py-3 text-sm leading-relaxed text-warning-text"
        >
          {entitlement.blockedReason}{" "}
          <Link href="/settings" className="font-medium underline underline-offset-2">
            Connect your key
          </Link>
          .
        </div>
      )}

      {setupDone < setup.length && (
        <section aria-labelledby="setup-heading" className="mt-8 rounded-xl border border-line bg-surface p-5">
          <h2 id="setup-heading" className="type-h2">
            Getting started · {setupDone} of {setup.length}
            <Help label="Getting started">
              Four steps from nothing to a report you can hand over. Each ticks itself when it has
              actually happened. The <Link href="/guide" className="underline underline-offset-2">step-by-step guide</Link> explains each one.
            </Help>
          </h2>
          <ol className="mt-3 space-y-2">
            {setup.map((step, i) => {
              const next = !step.done && setup.slice(0, i).every((s) => s.done);
              return (
                <li key={step.label} className="flex items-center gap-3 text-sm">
                  <span
                    aria-hidden="true"
                    className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${step.done ? "bg-pass-surface text-pass-text" : next ? "bg-ink text-on-ink" : "border border-line-strong text-ink-faint"}`}
                  >
                    {step.done ? "✓" : i + 1}
                  </span>
                  {step.done ? (
                    <span className="text-ink-faint line-through">{step.label}<span className="sr-only"> — done</span></span>
                  ) : (
                    <Link href={step.href} className={next ? "font-medium text-ink underline underline-offset-2" : "text-ink-soft hover:text-ink"}>
                      {step.label}
                    </Link>
                  )}
                </li>
              );
            })}
          </ol>
        </section>
      )}

      {attention.length > 0 && (
        <Reveal className="mt-8">
          <section aria-labelledby="attention-heading">
            <h2 id="attention-heading" className="type-h2">
              Needs you
            </h2>
            <ul className="mt-3 space-y-2">
              {attention.map((item) => (
                <li key={`${item.href}-${item.text}`}>
                  <Card className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                    <div className="flex min-w-0 items-center gap-2.5">
                      <Badge tone={item.tone}>{item.tone === "fail" ? "broken" : item.tone === "high" ? "open" : "waiting"}</Badge>
                      <p className="type-body">{item.text}</p>
                    </div>
                    <Link
                      href={item.href}
                      className="shrink-0 text-sm font-medium text-ink underline-offset-2 hover:underline"
                    >
                      {item.action} →
                    </Link>
                  </Card>
                </li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal className="mt-8">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Agents" value={agents?.length ?? 0} />
          <Stat label="Completed runs" value={completed} />
          <Stat label="Reports issued" value={reportCount ?? 0} />
        </dl>
      </Reveal>

      <Reveal className="mt-10" delay={60}>
        <section>
          <h2 className="type-h2">
            Agents
            <Help label="Agents">
              The support agents you have connected. Open one to write its policy, check its
              connection and run the suite against it. Only test agents you own or are authorised to test.
            </Help>
          </h2>
          {agents && agents.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {agents.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`} className="block">
                    <Card interactive className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="truncate font-mono text-xs text-ink-faint">
                          {(a.config as { url?: string })?.url}
                        </p>
                      </div>
                      {a.attested_at ? (
                        <Badge tone="pass">Authorised</Badge>
                      ) : (
                        <Badge tone="error">No authorisation</Badge>
                      )}
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyState
                title="No agents yet"
                action={
                  <ButtonLink href="/agents/new">Connect an agent</ButtonLink>
                }
              >
                Connect an agent you own, or one you have permission to test. Novera makes one
                harmless request first so you can see the answer before running anything.
              </EmptyState>
            </div>
          )}
        </section>
      </Reveal>

      <Reveal className="mt-10" delay={120}>
        <section>
          <h2 className="type-h2">
            Recent runs
            <Help label="Runs">
              A run sends every scenario in a suite to one agent and grades each answer against its
              policy. Open a run to see each verdict, fix failures and share the report.
            </Help>
          </h2>
          {runs && runs.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="block">
                    <Card interactive className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{agentNames.get(r.agent_id) ?? "Agent"}</p>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                        </p>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {/* What it found, not only that it finished. Absent while a
                            run is still going, because a partial count read as a
                            result is the thing this product exists not to do. */}
                        {r.status === "completed" && outcomes.get(r.id as string) && (
                          <span className="tnum text-xs text-ink-soft">
                            {outcomes.get(r.id as string)!.pass} passed
                            {outcomes.get(r.id as string)!.fail > 0 && (
                              <span className="text-fail-text">
                                {" · "}
                                {outcomes.get(r.id as string)!.fail} failed
                              </span>
                            )}
                            {outcomes.get(r.id as string)!.error > 0 && (
                              <span className="text-warning-text">
                                {" · "}
                                {outcomes.get(r.id as string)!.error} no result
                              </span>
                            )}
                          </span>
                        )}
                        <Badge
                          tone={r.status === "completed" ? "pass" : r.status === "aborted" ? "fail" : "live"}
                          pulse={r.status === "running" || r.status === "queued"}
                        >
                          {r.status}
                        </Badge>
                      </div>
                    </Card>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <div className="mt-3">
              <EmptyState title="No runs yet">
                Once an agent is connected and a policy version is saved, run the suite to produce
                a report.
              </EmptyState>
            </div>
          )}
        </section>
      </Reveal>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <Card className="p-4">
      <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
      <dt className="mt-0.5 text-xs uppercase tracking-wider text-ink-faint">{label}</dt>
    </Card>
  );
}
