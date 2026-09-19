import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { signOut } from "../sign-in/actions.ts";

export const metadata: Metadata = { title: "Dashboard · Novera" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const { user, workspace } = await requireWorkspace();
  const db = await sessionClient();

  // Read through the user's own client: whatever comes back, RLS allowed.
  const [{ data: agents }, { data: runs }] = await Promise.all([
    db.from("agents").select("id, name, kind, attested_at").order("created_at"),
    db
      .from("runs")
      .select("id, status, created_at, agent_id, policy_id")
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

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
        <form action={signOut}>
          <button
            type="submit"
            className="rounded-lg border border-slate-300 px-3 py-1.5 text-sm font-medium transition hover:bg-slate-50"
          >
            Sign out
          </button>
        </form>
      </header>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Agents</h2>
        {agents && agents.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {agents.map((a) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="text-sm font-medium">{a.name}</p>
                  <p className="text-xs text-slate-500">
                    {a.kind === "http" ? "HTTP endpoint" : "System prompt"}
                    {a.attested_at ? " · authorisation recorded" : " · no authorisation recorded"}
                  </p>
                </div>
                <Link href={`/agents/${a.id}`} className="text-sm font-medium underline underline-offset-2">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600">
            No agents yet. Connect an agent you own or are authorised to test.
          </p>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold tracking-tight">Recent runs</h2>
        {runs && runs.length > 0 ? (
          <ul className="mt-3 divide-y divide-slate-100 rounded-lg border border-slate-200">
            {runs.map((r) => (
              <li key={r.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <p className="font-mono text-xs text-slate-500">{r.id}</p>
                  <p className="text-xs text-slate-500">
                    {new Date(r.created_at).toISOString().slice(0, 16).replace("T", " ")} · {r.status}
                  </p>
                </div>
                <Link href={`/runs/${r.id}`} className="text-sm font-medium underline underline-offset-2">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 rounded-lg border border-dashed border-slate-300 px-4 py-6 text-sm text-slate-600">
            No runs yet.
          </p>
        )}
      </section>
    </main>
  );
}
