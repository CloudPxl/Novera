import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { signOut } from "../sign-in/actions.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Button } from "@/components/ui/button.tsx";

export const metadata: Metadata = { title: "Dashboard · Novera" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();

  // Read through the user's own client: whatever comes back, RLS allowed.
  const [{ data: agents }, { data: runs }, { count: reportCount }] = await Promise.all([
    db.from("agents").select("id, name, config, attested_at").order("created_at"),
    db.from("runs").select("id, status, created_at, agent_id").order("created_at", { ascending: false }).limit(6),
    db.from("reports").select("*", { count: "exact", head: true }),
  ]);

  const agentNames = new Map((agents ?? []).map((a) => [a.id, a.name]));
  const completed = (runs ?? []).filter((r) => r.status === "completed").length;

  return (
    <main className="mx-auto w-full max-w-4xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-200 pb-6">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Novera</p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight">{workspace.name}</h1>
          <p className="mt-1 text-sm text-slate-600">
            {user.email} · {workspace.plan === "trial" ? "Trial" : "Paid"} workspace
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/agents/new">
            <Button size="sm">Connect an agent</Button>
          </Link>
          <form action={signOut}>
            <Button type="submit" variant="secondary" size="sm">Sign out</Button>
          </form>
        </div>
      </header>

      <Reveal className="mt-8">
        <dl className="grid grid-cols-3 gap-3">
          <Stat label="Agents" value={agents?.length ?? 0} />
          <Stat label="Completed runs" value={completed} />
          <Stat label="Reports issued" value={reportCount ?? 0} />
        </dl>
      </Reveal>

      <Reveal className="mt-10" delay={60}>
        <section>
          <h2 className="text-lg font-semibold tracking-tight">Agents</h2>
          {agents && agents.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {agents.map((a) => (
                <li key={a.id}>
                  <Link href={`/agents/${a.id}`} className="block">
                    <Card interactive className="flex items-center justify-between gap-4 px-4 py-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{a.name}</p>
                        <p className="truncate font-mono text-xs text-slate-500">
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
                  <Link href="/agents/new">
                    <Button>Connect an agent</Button>
                  </Link>
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
          <h2 className="text-lg font-semibold tracking-tight">Recent runs</h2>
          {runs && runs.length > 0 ? (
            <ul className="mt-3 space-y-2">
              {runs.map((r) => (
                <li key={r.id}>
                  <Link href={`/runs/${r.id}`} className="block">
                    <Card interactive className="flex items-center justify-between px-4 py-3">
                      <div>
                        <p className="text-sm font-medium">{agentNames.get(r.agent_id) ?? "Agent"}</p>
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
      <dt className="mt-0.5 text-xs uppercase tracking-wider text-slate-500">{label}</dt>
    </Card>
  );
}
