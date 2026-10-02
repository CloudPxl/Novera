import type { Metadata } from "next";
import Link from "next/link";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { PageHeader, Panel, Rows } from "@/components/ui/page.tsx";
import { readinessOf, READINESS_LABEL, type Readiness } from "@/lib/report/readiness.ts";
import type { ReportPayload } from "@/lib/report/payload.ts";
import { formatWhen } from "@/lib/format/when.ts";
import { summariseRun } from "../dashboard/summary.ts";

export const metadata: Metadata = { title: "Reports · Novera" };
export const dynamic = "force-dynamic";

const READY_TONE: Record<Readiness, "pass" | "neutral" | "error" | "fail"> = {
  READY_TO_SHARE: "pass", READY_FOR_INTERNAL_REVIEW: "neutral", INCOMPLETE: "error", WITHHELD: "error",
  BLOCKED_BY_EVIDENCE: "fail", REVOKED: "neutral", EXPIRED: "neutral",
};

/**
 * Every sealed report in the workspace, newest first — what a client can be sent. Readiness is
 * computed from each sealed document (src/lib/report/readiness.ts), never set by hand; a
 * withdrawn or expired one says so. Sharing, exports and withdrawal stay on the run's page.
 */
export default async function ReportsPage() {
  const { workspace, context } = await requireWorkspace();
  const db = await sessionClient();
  const [{ data: reports }, { data: agents }] = await Promise.all([
    db.from("reports").select("run_id, token, payload, content_hash, expires_at, revoked_at, created_at, runs(agent_id, status, created_at)")
      .eq("workspace_id", workspace.id).order("created_at", { ascending: false }).limit(100),
    db.from("agents").select("id, name").eq("workspace_id", workspace.id),
  ]);
  const agentName = new Map((agents ?? []).map((a) => [a.id as string, a.name as string]));
  const personal = context.accountMode === "personal";

  const rows = (reports ?? []).map((r) => {
    const payload = r.payload as unknown as ReportPayload;
    const run = r.runs as unknown as { agent_id: string; status: string; created_at: string } | null;
    const ready = readinessOf({ report: { payload, content_hash: r.content_hash as string, expires_at: r.expires_at as string, revoked_at: (r.revoked_at as string | null) ?? null }, undisclosedReviews: 0 });
    const sum = summariseRun({ status: "completed", payload: payload as never, scheduleId: null, apiKeyName: null });
    // Read from the sealed document, so a report says what it was sealed with.
    return { r, run, ready, sum, suite: payload.run?.suite ?? null, policyVersion: payload.subject?.policy_version ?? null };
  });

  return (
    <main className="w-full pb-8 text-ink">
      <PageHeader
        eyebrow={personal ? "My reports" : "Reports"}
        title="Reports"
        description="Sealed documents you can hand over. Each is ready to share only when its sealed evidence supports it."
      />
      {rows.length === 0 ? (
        <EmptyState title="No reports yet">A report is sealed when a run finishes. Run the suite against an agent to produce the first one.</EmptyState>
      ) : (
        <Panel>
          <Rows label="Reports">
            {rows.map(({ r, run, ready, sum, suite, policyVersion }) => (
              <li key={r.token as string}>
                <Link href={`/runs/${r.run_id}#report`} className="grid gap-x-6 gap-y-1.5 px-5 py-3.5 transition-colors hover:bg-ground md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{run ? agentName.get(run.agent_id) ?? "Agent" : "Agent"}</span>
                      <Badge tone={sum.tone}>{sum.stateLabel}</Badge>
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-faint">
                      Sealed {formatWhen(r.created_at as string, context.profile)}
                      {suite ? ` · ${suite}` : ""}{policyVersion ? ` · policy v${policyVersion}` : ""}
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2">
                    <Badge tone={READY_TONE[ready.state]}>{READINESS_LABEL[ready.state]}</Badge>
                  </span>
                  <span className="text-xs text-ink-faint">
                    {r.revoked_at ? `Withdrawn ${formatWhen(r.revoked_at as string, context.profile, { date: true })}` : `Link expires ${formatWhen(r.expires_at as string, context.profile, { date: true })}`}
                  </span>
                </Link>
              </li>
            ))}
          </Rows>
        </Panel>
      )}
    </main>
  );
}
