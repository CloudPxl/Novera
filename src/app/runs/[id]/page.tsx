import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { LiveRun } from "./live.tsx";

export const metadata: Metadata = { title: "Run · Novera" };
export const dynamic = "force-dynamic";

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireWorkspace();
  const db = await sessionClient();

  const { data: run } = await db
    .from("runs").select("id, status, agent_id, policy_id, suite_id, baseline_run_id, error, created_at")
    .eq("id", id).maybeSingle();
  if (!run) notFound();

  const [{ data: agent }, { data: policy }, { data: suite }, { data: report }] = await Promise.all([
    db.from("agents").select("name").eq("id", run.agent_id).maybeSingle(),
    db.from("policies").select("version").eq("id", run.policy_id).maybeSingle(),
    db.from("suites").select("name, cases").eq("id", run.suite_id).maybeSingle(),
    db.from("reports").select("token").eq("run_id", id).maybeSingle(),
  ]);

  const plannedCases = Array.isArray(suite?.cases) ? suite.cases.length : 0;

  return (
    <main className="mx-auto w-full max-w-3xl bg-white px-6 py-10 text-slate-900 sm:px-8">
      <Link href={`/agents/${run.agent_id}`} className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← {agent?.name ?? "Agent"}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Suite run</h1>
      <p className="mt-1 text-sm text-slate-600">
        {suite?.name} · policy v{policy?.version} ·{" "}
        {new Date(run.created_at).toISOString().slice(0, 16).replace("T", " ")}
      </p>

      <LiveRun
        runId={run.id}
        initialStatus={run.status}
        plannedCases={plannedCases}
        initialError={run.error}
        reportToken={report?.token ?? null}
        hasBaseline={Boolean(run.baseline_run_id)}
      />
    </main>
  );
}
