import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { workspaceEntitlement } from "@/lib/auth/entitlement.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { createRun } from "@/lib/workflow/actions.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { PolicyEditor, ReprobeButton, VerificationEndpoint, ResponsePathPicker } from "./client.tsx";

export const metadata: Metadata = { title: "Agent · Novera" };
export const dynamic = "force-dynamic";

export default async function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();
  const entitlement = await workspaceEntitlement({
    client: await assertMembership(user.id, workspace.id),
    workspaceId: workspace.id,
  });

  const { data: agent } = await db
    .from("agents").select("id, name, kind, config, verification, attestation_text, attested_at").eq("id", id).maybeSingle();
  if (!agent) notFound();

  const [{ data: probes }, { data: policies }, { data: runs }, { data: suites }] = await Promise.all([
    db.from("probes").select("id, status_code, response_body, response_shape, latency_ms, error, created_at")
      .eq("agent_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("policies").select("id, version, body, created_at")
      .eq("agent_id", id).order("version", { ascending: false }),
    db.from("runs").select("id, status, created_at, suite_id").eq("agent_id", id)
      .order("created_at", { ascending: false }).limit(8),
    // Newest version first within a key, so the default below is the current suite
    // rather than whichever row Postgres happened to return first.
    db.from("suites").select("id, key, version, name").order("key").order("version", { ascending: false }),
  ]);

  const latestProbe = probes?.[0];
  const latestPolicy = policies?.[0];
  const config = agent.config as { url?: string; responsePath?: string; toolActivityPath?: string };

  return (
    <main className="w-full max-w-3xl py-8 text-ink">
      <Link href="/dashboard" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Dashboard
      </Link>

      <header className="mt-4 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <p className="mt-1 break-all font-mono text-xs text-slate-500">{config.url}</p>
        </div>
        {agent.attested_at ? (
          <Badge tone="pass">Authorisation recorded</Badge>
        ) : (
          <Badge tone="error">No authorisation recorded</Badge>
        )}
      </header>

      <Reveal className="mt-8">
        <section>
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold tracking-tight">Connection</h2>
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
                <span className="text-xs text-slate-500">
                  {new Date(latestProbe.created_at).toISOString().slice(0, 16).replace("T", " ")}
                </span>
              </div>
              <p className="mt-3 text-sm leading-relaxed text-slate-700">
                {latestProbe.error ?? latestProbe.response_body?.slice(0, 400)}
              </p>
              <p className="mt-2 text-xs text-slate-500">
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
            <p className="mt-3 text-sm text-slate-600">No connection receipt yet.</p>
          )}
        </section>
      </Reveal>

      <Reveal className="mt-10" delay={50}>
        <section>
          <h2 className="text-lg font-semibold tracking-tight">Verifying what the agent does</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            A tool call is not an effect, and the agent saying it refunded an order is
            not a refund. This is where Novera goes to find out.
          </p>
          <VerificationEndpoint
            agentId={agent.id}
            current={(agent.verification as { url?: string; authHeaderName?: string } | null) ?? null}
          />
        </section>
      </Reveal>

      <Reveal className="mt-10" delay={60}>
        <section>
          <h2 className="text-lg font-semibold tracking-tight">Policy</h2>
          <p className="mt-1 text-sm leading-relaxed text-slate-600">
            Every version is kept. Saving creates a new one — an existing version can never be
            edited, so a report always names exactly what the agent was tested against.
          </p>
          <PolicyEditor
            agentId={agent.id}
            latest={latestPolicy ? { version: latestPolicy.version, body: latestPolicy.body } : null}
            history={(policies ?? []).map((p) => ({ version: p.version, createdAt: p.created_at }))}
          />
        </section>
      </Reveal>

      <Reveal className="mt-10" delay={120}>
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold tracking-tight">Runs</h2>
            {latestPolicy && entitlement.canRun && (
              <form action={createRun} className="flex flex-wrap items-center gap-2">
                <input type="hidden" name="agentId" value={agent.id} />
                {(suites ?? []).length > 1 && (
                  <select
                    name="suiteId"
                    aria-label="Suite to run"
                    defaultValue={(suites ?? []).find((s) => s.key === "eu-support")?.id}
                    className="rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-sm outline-none focus:border-slate-900 focus:ring-1 focus:ring-slate-900"
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
              </form>
            )}
          </div>

          {!entitlement.canRun && (
            <div
              role="status"
              className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900"
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
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="block">
                    <Card interactive className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="font-mono text-xs text-slate-500">{r.id.slice(0, 8)}</p>
                        <p className="mt-0.5 text-xs text-slate-500">
                          {(suites ?? []).find((s) => s.id === r.suite_id)?.name ?? "Suite"} ·{" "}
                          {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")}
                        </p>
                      </div>
                      <Badge
                        tone={r.status === "completed" ? "pass" : r.status === "aborted" ? "fail" : "live"}
                        pulse={r.status === "running" || r.status === "queued"}
                      >
                        {r.status}
                      </Badge>
                    </Card>
                  </Link>
                </li>
              ))}
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
      </Reveal>
    </main>
  );
}
