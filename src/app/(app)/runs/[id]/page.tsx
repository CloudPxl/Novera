import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { rerunFrom } from "@/lib/workflow/actions.ts";
import { compareRuns } from "@/lib/evidence/compare.ts";
import { coverage, coverageByCategory } from "@/lib/evidence/coverage.ts";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { gradeRun } from "@/lib/evidence/grade.ts";
import { obligationLabel } from "@/lib/report/payload.ts";
import { resolveAssertions } from "@/lib/judge/parse.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { SubmitButton } from "@/components/ui/button.tsx";
import { LiveRun } from "./live.tsx";
import { Scorecard, type Corroboration } from "./scorecard.tsx";
import { CaseTable, CategoryCard, type CaseRow } from "./case-table.tsx";
import { DiagnoseButton, ProposalCard, type Proposal } from "./diagnose.tsx";

export const metadata: Metadata = { title: "Run · Novera" };
export const dynamic = "force-dynamic";

const CHANGE_TONES = {
  fixed: "pass",
  newFailures: "fail",
  persistentFailures: "neutral",
  nowErrored: "error",
} as const;

function asStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await requireWorkspace();
  const db = await sessionClient();

  const { data: run } = await db
    .from("runs")
    .select(
      "id, status, agent_id, policy_id, suite_id, baseline_run_id, error, created_at, started_at, finished_at, pass_threshold, judge_model",
    )
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const [{ data: agent }, { data: policy }, { data: suite }, { data: report }] = await Promise.all([
    db.from("agents").select("name").eq("id", run.agent_id).maybeSingle(),
    db.from("policies").select("version").eq("id", run.policy_id).maybeSingle(),
    db.from("suites").select("name, version, cases").eq("id", run.suite_id).maybeSingle(),
    db.from("reports").select("token").eq("run_id", id).maybeSingle(),
  ]);

  const suiteCases = Array.isArray(suite?.cases) ? (suite.cases as Array<Record<string, unknown>>) : [];
  const plannedCases = suiteCases.length;
  const settled = run.status === "completed" || run.status === "aborted";

  // While the run is in flight the live view owns the page: it reads the same rows,
  // but streams them. Once the run has settled the server renders them instead, so
  // the decision controls below are here on first paint rather than after a poll.
  const rows = settled
    ? (
        await db
          .from("run_cases")
          .select(
            "id, case_id, category, obligation, severity, status, input, expected, assertions, failed_assertions, response_text, rationale, error, latency_ms, judge_model, judge_agreement",
          )
          .eq("run_id", id)
          .order("case_id")
      ).data ?? []
    : [];

  const { data: proposals } = settled && rows.length
    ? await db
        .from("diagnoses")
        .select("id, run_case_id, analysis, quoted_old, proposed_new, risks, status, decided_at, resulting_policy_id")
        .in("run_case_id", rows.map((c) => c.id))
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
      risks: asStrings(p.risks),
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
  if (settled && run.baseline_run_id && rows.length) {
    const { data: before } = await db
      .from("run_cases").select("case_id, status").eq("run_id", run.baseline_run_id);
    if (before?.length) {
      comparison = compareRuns(
        before.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
        rows.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
      );
      const { data: beforeRun } = await db
        .from("runs").select("policy_id").eq("id", run.baseline_run_id).maybeSingle();
      const { data: beforePolicy } = beforeRun
        ? await db.from("policies").select("version").eq("id", beforeRun.policy_id).maybeSingle()
        : { data: null };
      baselinePolicyVersion = (beforePolicy?.version as number | undefined) ?? null;
    }
  }

  const statuses = rows.map((c) => ({
    status: c.status as "pass" | "fail" | "error",
    category: c.category as string,
    severity: c.severity as string,
  }));

  const runCoverage = coverage({ plannedCases, cases: statuses });
  const grade = gradeRun({ coverage: runCoverage, threshold: (run.pass_threshold as number) ?? 80 });

  // Planned counts come from the suite, not from the rows: a category whose cases all
  // failed to execute must still appear, or the grid would quietly shrink to the part
  // of the suite that happened to work.
  const plannedByCategory: Record<string, number> = {};
  for (const c of suiteCases) {
    const key = typeof c.category === "string" ? c.category : "uncategorised";
    plannedByCategory[key] = (plannedByCategory[key] ?? 0) + 1;
  }
  const categories = coverageByCategory(statuses, plannedByCategory);

  const corroboration = rows.reduce<Corroboration>(
    (acc, c) => {
      const a = c.judge_agreement as string | null;
      if (a === "agreed") acc.agreed += 1;
      else if (a === "majority") acc.settled += 1;
      else if (a === "unconfirmed") acc.unconfirmed += 1;
      else if (a === "unresolved") acc.unresolved += 1;
      return acc;
    },
    { agreed: 0, settled: 0, unconfirmed: 0, unresolved: 0 },
  );

  const caseRows: CaseRow[] = rows.map((c) => ({
    id: c.id as string,
    caseId: c.case_id as string,
    category: c.category as string,
    categoryLabel: categoryMeta(c.category as string).label,
    obligation: c.obligation as string,
    obligationLabel: obligationLabel(c.obligation as string),
    severity: c.severity as string,
    status: c.status as "pass" | "fail" | "error",
    input: c.input as string,
    expected: (c.expected as string) ?? "",
    assertions: asStrings(c.assertions),
    // Rows stored before the judge boundary was fixed hold the judge's numbered echo
    // ("1. ...") rather than the suite's wording. Evidence is append-only, so those
    // rows cannot be rewritten — they are resolved on the way out instead.
    failedAssertions: resolveAssertions(asStrings(c.assertions), asStrings(c.failed_assertions)),
    responseText: (c.response_text as string | null) ?? null,
    rationale: (c.rationale as string | null) ?? null,
    error: (c.error as string | null) ?? null,
    judgeModel: (c.judge_model as string | null) ?? null,
    judgeAgreement: (c.judge_agreement as string | null) ?? null,
    latencyMs: (c.latency_ms as number | null) ?? null,
  }));

  // The diagnosis controls are server-rendered per case and handed to the client
  // matrix as slots, so the server actions they submit to stay server actions.
  const diagnosis: Record<string, React.ReactNode> = {};
  for (const c of rows) {
    if (c.status === "pass") continue;
    const forCase = proposalsByCase.get(c.id as string) ?? [];
    diagnosis[c.id as string] = (
      <>
        <DiagnoseButton runCaseId={c.id as string} hasProposal={forCase.length > 0} />
        {forCase.map((p) => (
          <ProposalCard key={p.id} proposal={p} />
        ))}
      </>
    );
  }

  const undecided = (proposals ?? []).filter((p) => p.status === "proposed").length;
  const suiteLabel = suite ? `${suite.name} v${suite.version}` : "Suite";

  return (
    <main className="w-full max-w-[1200px] py-8 text-ink">
      <Link href={`/agents/${run.agent_id}`} className="text-sm text-ink-soft underline-offset-2 hover:underline">
        ← {agent?.name ?? "Agent"}
      </Link>

      {!settled ? (
        <div className="mt-4">
          <LiveRun
            runId={run.id}
            initialStatus={run.status}
            plannedCases={plannedCases}
            initialError={run.error}
            reportToken={report?.token ?? null}
            hasBaseline={Boolean(run.baseline_run_id)}
          />
        </div>
      ) : (
        <>
          {/* --------------------------------------------------- tier 1: grade */}
          <div className="mt-4">
            <Scorecard
              grade={grade}
              coverage={runCoverage}
              corroboration={corroboration}
              agentName={agent?.name ?? "Agent"}
              policyVersion={(policy?.version as number | undefined) ?? null}
              suiteLabel={suiteLabel}
              createdAt={run.created_at as string}
              startedAt={(run.started_at as string | null) ?? null}
              finishedAt={(run.finished_at as string | null) ?? null}
              judgeModel={(run.judge_model as string | null) ?? null}
              status={run.status as string}
              runError={(run.error as string | null) ?? null}
            />
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {report?.token && (
              <Link
                href={`/report/${report.token}`}
                className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-sm font-medium text-white transition-all duration-150 hover:bg-slate-700 active:scale-[0.98]"
              >
                Open the client report
              </Link>
            )}
            <form action={rerunFrom}>
              <input type="hidden" name="runId" value={run.id} />
              <SubmitButton variant="secondary" size="sm" pendingLabel="Starting…">
                Rerun and compare against this
              </SubmitButton>
            </form>
            {undecided > 0 && (
              <span className="text-xs text-warning-text">
                {undecided} proposed change{undecided === 1 ? "" : "s"} still waiting on a decision.
              </span>
            )}
          </div>

          {/* ------------------------------------------------ tier 2: categories */}
          {categories.length > 0 && (
            <section className="mt-8">
              <h2 className="type-h2">By category</h2>
              <p className="mt-1 type-body text-ink-soft">
                A percentage can look healthy while the one case that mattered is the one
                that failed, so a failed critical scenario is marked on its category.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {categories.map((c) => {
                  const meta = categoryMeta(c.category);
                  return (
                    <CategoryCard
                      key={c.category}
                      label={meta.label}
                      description={meta.description}
                      passed={c.passed}
                      graded={c.graded}
                      planned={c.planned}
                      criticalFailure={c.criticalFailure}
                    />
                  );
                })}
              </div>
            </section>
          )}

          {/* --------------------------------------------------- tier 3: matrix */}
          <section className="mt-8">
            <h2 className="type-h2">Scenarios</h2>
            {caseRows.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="Nothing was graded">
                  This run produced no gradable result, so there is nothing to diagnose.
                </EmptyState>
              </div>
            ) : (
              <div className="mt-3 rounded-panel border border-line bg-surface p-3 shadow-card sm:p-4">
                <CaseTable cases={caseRows} diagnosis={diagnosis} />
              </div>
            )}
          </section>

          {/* ----------------------------------------------- tier 4: comparison */}
          {comparison && (
            <Reveal className="mt-10">
              <section>
                <h2 className="type-h2">Compared with the previous run</h2>
                <p className="mt-1 type-body text-ink-soft">
                  Policy v{baselinePolicyVersion ?? "?"} → v{policy?.version}.{" "}
                  {comparison.comparable
                    ? "Both runs covered the same scenarios."
                    : "The two runs did not cover exactly the same scenarios, so this comparison is partial."}
                </p>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                  <p className="mt-3 text-sm text-warning-text">
                    Coverage lost since the baseline: {comparison.missingFromCurrent.join(", ")}.
                  </p>
                )}
              </section>
            </Reveal>
          )}
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
        <span className="type-h3">{title}</span>
        <Badge tone={ids.length ? tone : "neutral"}>{ids.length}</Badge>
      </div>
      {ids.length > 0 ? (
        <p className="mt-2 type-mono text-xs leading-relaxed text-ink-soft">{ids.join(", ")}</p>
      ) : (
        <p className="mt-2 text-xs leading-relaxed text-ink-faint">{empty}</p>
      )}
    </Card>
  );
}
