import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { rerunFrom } from "@/lib/workflow/actions.ts";
import { compareRuns } from "@/lib/evidence/compare.ts";
import { obligationLabel } from "@/lib/report/payload.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { LiveRun } from "./live.tsx";
import { gradingNote } from "./grading-note.ts";
import { DiagnoseButton, ProposalCard, type Proposal } from "./diagnose.tsx";

export const metadata: Metadata = { title: "Run · Novera" };
export const dynamic = "force-dynamic";

const CHANGE_TONES = {
  fixed: "pass",
  newFailures: "fail",
  persistentFailures: "neutral",
  nowErrored: "error",
} as const;

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
  const settled = run.status === "completed" || run.status === "aborted";

  // While the run is in flight the live view owns the page: it reads the same rows,
  // but streams them. Once the run has settled the server renders them instead, so
  // the decision controls below are here on first paint rather than after a poll.
  const cases = settled
    ? (
        await db
          .from("run_cases")
          .select("id, case_id, obligation, severity, status, rationale, error, judge_model, judge_agreement, response_text")
          .eq("run_id", id)
          .order("case_id")
      ).data ?? []
    : [];

  const { data: proposals } = settled && cases.length
    ? await db
        .from("diagnoses")
        .select("id, run_case_id, analysis, quoted_old, proposed_new, risks, status, decided_at, resulting_policy_id")
        .in("run_case_id", cases.map((c) => c.id))
        .order("created_at")
    : { data: null };

  // Map the policy a proposal produced to its version number, so an approved change
  // can say what it became rather than showing an opaque id.
  const producedIds = (proposals ?? []).map((p) => p.resulting_policy_id).filter(Boolean) as string[];
  const { data: producedPolicies } = producedIds.length
    ? await db.from("policies").select("id, version").in("id", producedIds)
    : { data: null };
  const versionOf = new Map((producedPolicies ?? []).map((p) => [p.id as string, p.version as number]));

  const proposalsByCase = new Map<string, Proposal[]>();
  for (const p of proposals ?? []) {
    const list = proposalsByCase.get(p.run_case_id as string) ?? [];
    list.push({
      id: p.id as string,
      analysis: p.analysis as string,
      quotedOld: (p.quoted_old as string | null) ?? null,
      proposedNew: p.proposed_new as string,
      risks: Array.isArray(p.risks) ? (p.risks as string[]) : [],
      status: p.status as Proposal["status"],
      decidedAt: (p.decided_at as string | null) ?? null,
      resultingPolicyVersion: p.resulting_policy_id
        ? versionOf.get(p.resulting_policy_id as string) ?? null
        : null,
    });
    proposalsByCase.set(p.run_case_id as string, list);
  }

  // Comparison against the run this one was measured from.
  let comparison: ReturnType<typeof compareRuns> | null = null;
  let baselinePolicyVersion: number | null = null;
  if (settled && run.baseline_run_id && cases.length) {
    const { data: before } = await db
      .from("run_cases").select("case_id, status").eq("run_id", run.baseline_run_id);
    if (before?.length) {
      comparison = compareRuns(
        before.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
        cases.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
      );
      const { data: beforeRun } = await db
        .from("runs").select("policy_id").eq("id", run.baseline_run_id).maybeSingle();
      const { data: beforePolicy } = beforeRun
        ? await db.from("policies").select("version").eq("id", beforeRun.policy_id).maybeSingle()
        : { data: null };
      baselinePolicyVersion = (beforePolicy?.version as number | undefined) ?? null;
    }
  }

  const graded = cases.filter((c) => c.status !== "error").length;
  const passed = cases.filter((c) => c.status === "pass").length;
  const errored = cases.filter((c) => c.status === "error").length;
  const undecided = (proposals ?? []).filter((p) => p.status === "proposed").length;

  return (
    <main className="w-full max-w-3xl py-8 text-ink">
      <Link href={`/agents/${run.agent_id}`} className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← {agent?.name ?? "Agent"}
      </Link>

      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Suite run</h1>
      <p className="mt-1 text-sm text-slate-600">
        {suite?.name} · policy v{policy?.version} ·{" "}
        {new Date(run.created_at).toISOString().slice(0, 16).replace("T", " ")}
      </p>

      {!settled ? (
        <LiveRun
          runId={run.id}
          initialStatus={run.status}
          plannedCases={plannedCases}
          initialError={run.error}
          reportToken={report?.token ?? null}
          hasBaseline={Boolean(run.baseline_run_id)}
        />
      ) : (
        <>
          <Card className="mt-6 p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={run.status === "completed" ? "pass" : "fail"}>{run.status}</Badge>
                <span className="text-sm text-slate-600">
                  {cases.length} of {plannedCases} scenarios
                </span>
              </div>
              <span className="text-sm font-medium tabular-nums">
                {graded > 0 ? `${Math.round((passed / graded) * 1000) / 10}%` : "no score"}
              </span>
            </div>

            <div className="mt-4 h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="novera-bar h-full rounded-full bg-slate-900"
                style={{ width: `${plannedCases ? Math.round((cases.length / plannedCases) * 100) : 0}%` }}
                role="progressbar"
                aria-valuenow={cases.length}
                aria-valuemin={0}
                aria-valuemax={plannedCases}
                aria-label="Scenarios graded"
              />
            </div>

            <div className="mt-4 flex flex-wrap gap-2 text-xs">
              <Badge tone="pass">{passed} passed</Badge>
              <Badge tone="fail">{cases.length - passed - errored} failed</Badge>
              {errored > 0 && <Badge tone="error">{errored} no result</Badge>}
            </div>

            {run.error && (
              <p role="alert" className="mt-4 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
                {run.error}
              </p>
            )}

            <div className="mt-5 flex flex-wrap items-center gap-3 border-t border-slate-200 pt-4">
              {report?.token && (
                <Link
                  href={`/report/${report.token}`}
                  className="inline-flex items-center gap-2 rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-slate-700 active:scale-[0.98]"
                >
                  Open the client report
                </Link>
              )}
              <form action={rerunFrom}>
                <input type="hidden" name="runId" value={run.id} />
                <SubmitButton variant="secondary" pendingLabel="Starting…">
                  Rerun and compare against this
                </SubmitButton>
              </form>
              {undecided > 0 && (
                <span className="text-xs text-amber-800">
                  {undecided} proposed change{undecided === 1 ? "" : "s"} still waiting on a decision.
                </span>
              )}
            </div>
          </Card>

          {comparison && (
            <Reveal className="mt-10">
              <section>
                <h2 className="text-lg font-semibold tracking-tight">Compared with the previous run</h2>
                <p className="mt-1 text-sm leading-relaxed text-slate-600">
                  Policy v{baselinePolicyVersion ?? "?"} → v{policy?.version}.{" "}
                  {comparison.comparable
                    ? "Both runs covered the same scenarios."
                    : "The two runs did not cover exactly the same scenarios, so this comparison is partial."}
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <ChangeGroup title="Fixed" tone={CHANGE_TONES.fixed} ids={comparison.fixed}
                    empty="Nothing that was failing is now passing." />
                  <ChangeGroup title="Newly broken" tone={CHANGE_TONES.newFailures} ids={comparison.newFailures}
                    empty="The change broke nothing that was passing." />
                  <ChangeGroup title="Still failing" tone={CHANGE_TONES.persistentFailures} ids={comparison.persistentFailures}
                    empty="No scenario failed in both runs." />
                  <ChangeGroup title="No result this time" tone={CHANGE_TONES.nowErrored} ids={comparison.nowErrored}
                    empty="Every scenario produced a verdict." />
                </div>

                {comparison.missingFromCurrent.length > 0 && (
                  <p className="mt-3 text-sm text-amber-800">
                    Coverage lost since the baseline: {comparison.missingFromCurrent.join(", ")}.
                  </p>
                )}
              </section>
            </Reveal>
          )}

          <section className="mt-10">
            <h2 className="text-lg font-semibold tracking-tight">Scenarios</h2>
            {cases.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="Nothing was graded">
                  This run produced no gradable result, so there is nothing to diagnose.
                </EmptyState>
              </div>
            ) : (
              <ul className="mt-3 space-y-2">
                {cases.map((c, i) => {
                  const forCase = proposalsByCase.get(c.id as string) ?? [];
                  return (
                    <Reveal key={c.id as string} delay={Math.min(i, 8) * 40}>
                      <Card className="p-4">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone={c.status === "pass" ? "pass" : c.status === "fail" ? "fail" : "error"}>
                            {c.status === "error" ? "no result" : (c.status as string)}
                          </Badge>
                          <span className="font-mono text-xs text-slate-500">{c.case_id as string}</span>
                          <span className="text-sm font-medium">{obligationLabel(c.obligation as string)}</span>
                        </div>

                        {(c.rationale || c.error) && (
                          <p className="mt-2 text-sm leading-relaxed text-slate-700">
                            {(c.rationale as string | null) ?? (c.error as string | null)}
                          </p>
                        )}

                        {c.status === "fail" && c.response_text && (
                          <details className="mt-2">
                            <summary className="cursor-pointer text-xs text-slate-500 hover:text-slate-700">
                              What the agent replied
                            </summary>
                            <p className="mt-2 whitespace-pre-wrap rounded-lg bg-slate-50 px-3 py-2 text-sm leading-relaxed text-slate-700">
                              {c.response_text as string}
                            </p>
                          </details>
                        )}

                        {c.judge_model && (
                          <p className="mt-1.5 font-mono text-[11px] text-slate-400">
                            {gradingNote(c.judge_model as string, c.judge_agreement as string | null)}
                          </p>
                        )}

                        {c.status !== "pass" && (
                          <DiagnoseButton runCaseId={c.id as string} hasProposal={forCase.length > 0} />
                        )}

                        {forCase.map((p) => (
                          <ProposalCard key={p.id} proposal={p} />
                        ))}
                      </Card>
                    </Reveal>
                  );
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </main>
  );
}

function ChangeGroup({
  title,
  tone,
  ids,
  empty,
}: {
  title: string;
  tone: "pass" | "fail" | "error" | "neutral";
  ids: string[];
  empty: string;
}) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{title}</span>
        <Badge tone={ids.length ? tone : "neutral"}>{ids.length}</Badge>
      </div>
      {ids.length > 0 ? (
        <p className="mt-2 font-mono text-xs leading-relaxed text-slate-600">{ids.join(", ")}</p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-slate-500">{empty}</p>
      )}
    </Card>
  );
}

