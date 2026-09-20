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
import { PolicyEditor, ReprobeButton } from "./client.tsx";

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
    .from("agents").select("id, name, kind, config, attestation_text, attested_at").eq("id", id).maybeSingle();
  if (!agent) notFound();

  const [{ data: probes }, { data: policies }, { data: runs }] = await Promise.all([
    db.from("probes").select("id, status_code, response_body, latency_ms, error, created_at")
      .eq("agent_id", id).order("created_at", { ascending: false }).limit(3),
    db.from("policies").select("id, version, body, created_at")
      .eq("agent_id", id).order("version", { ascending: false }),
    db.from("runs").select("id, status, created_at").eq("agent_id", id)
      .order("created_at", { ascending: false }).limit(8),
  ]);

  const latestProbe = probes?.[0];
  const latestPolicy = policies?.[0];
  const config = agent.config as { url?: string };

  return (
    <main className="mx-auto w-full max-w-3xl bg-white px-6 py-10 text-slate-900 sm:px-8">
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
            </Card>
          ) : (
            <p className="mt-3 text-sm text-slate-600">No connection receipt yet.</p>
          )}
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
              <form action={createRun}>
                <input type="hidden" name="agentId" value={agent.id} />
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
