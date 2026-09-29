import { describeTiming } from "@/lib/schedules/cadence.ts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { rerunFrom } from "@/lib/workflow/actions.ts";
import { compareRuns } from "@/lib/evidence/compare.ts";
import { loadStability } from "@/lib/evidence/stability-history.ts";
import { alignment, latestReviews, withFindingsApplied, type VerdictReview } from "@/lib/evidence/reviews.ts";
import { ReviewVerdict, ReviewHistory, ReissueReport, type ReviewEntry } from "./review.tsx";
import { unstableInComparison } from "@/lib/evidence/stability.ts";
import { coverage, coverageByCategory } from "@/lib/evidence/coverage.ts";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { gradeRun } from "@/lib/evidence/grade.ts";
import { obligationLabel } from "@/lib/report/payload.ts";
import { normaliseTrajectory } from "@/lib/agents/trajectory.ts";
import { resolveAssertions } from "@/lib/judge/parse.ts";
import { Help } from "@/components/ui/help.tsx";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { LiveRun } from "./live.tsx";
import { Scorecard, type Corroboration } from "./scorecard.tsx";
import { CaseTable, CategoryCard, type CaseRow } from "./case-table.tsx";
import { BaselinePicker } from "./baseline-picker.tsx";
import { DiagnoseButton, ProposalCard, RetestButton, RetestHistory, type Proposal, type Retest } from "./diagnose.tsx";

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

export default async function RunPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ compare?: string }>;
}) {
  const { id } = await params;
  const { compare } = await searchParams;
  const { user: viewer } = await requireWorkspace();
  const viewerId = viewer.id;
  const db = await sessionClient();

  const { data: run } = await db
    .from("runs")
    .select(
      "id, status, agent_id, policy_id, suite_id, baseline_run_id, error, created_at, started_at, finished_at, pass_threshold, judge_model, schedule_id, api_key_id",
    )
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();

  const [{ data: agent }, { data: policy }, { data: suite }, { data: reportRows }, { data: schedule }, { data: apiKey }] = await Promise.all([
    db.from("agents").select("name").eq("id", run.agent_id).maybeSingle(),
    db.from("policies").select("version").eq("id", run.policy_id).maybeSingle(),
    db.from("suites").select("name, version, cases").eq("id", run.suite_id).maybeSingle(),
    // Newest first: a run can carry a reissue that discloses human review, and a
    // single-row read of more than one report returns nothing at all.
    db.from("reports").select("token, created_at, revoked_at, disclosed:payload->human_review->>as_of").eq("run_id", id)
      .order("created_at", { ascending: false }),
    run.schedule_id
      ? db.from("run_schedules").select("cadence, hour_utc, weekday").eq("id", run.schedule_id).maybeSingle()
      : Promise.resolve({ data: null }),
    run.api_key_id
      ? db.from("api_keys").select("name").eq("id", run.api_key_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);
  const startedBy = schedule
    ? `started by the schedule “${describeTiming({
        cadence: schedule.cadence as "daily" | "weekly", hourUtc: schedule.hour_utc as number, weekday: schedule.weekday as number | null,
      })}”`
    : apiKey
      ? `started by the API key “${apiKey.name as string}”`
      : null;

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
            "id, case_id, category, obligation, severity, status, input, expected, assertions, failed_assertions, response_text, rationale, error, latency_ms, judge_model, judge_agreement, judge_votes, evidence_gap, settled_by, tool_activity, transcript, raw_expired_at, raw_sha256",
          )
          .eq("run_id", id)
          .order("case_id")
      ).data ?? []
    : [];

  const { data: proposals } = settled && rows.length
    ? await db
        .from("diagnoses")
        .select("id, run_case_id, analysis, quoted_old, proposed_new, risks, status, decided_at, resulting_policy_id, api_keys(name)")
        .in("run_case_id", rows.map((c) => c.id))
        .order("created_at")
    : { data: null };

  // Retests are their own evidence: stored, shown inline, never counted in a score
  // and never published. They are read here so a scenario can show whether a later
  // policy version fixed it without anyone re-running the suite to find out.
  const { data: retestRows } = settled && rows.length
    ? await db
        .from("case_retests")
        .select("id, run_case_id, policy_id, status, rationale, error, created_at")
        .in("run_case_id", rows.map((c) => c.id))
        .order("created_at", { ascending: false })
    : { data: null };

  // A person's findings on verdicts. Kept beside each verdict, never in place of it
  // (migration 0028), and read in one query for the whole run.
  const { data: reviewRows } = settled && rows.length
    ? await db
        .from("verdict_reviews")
        .select("id, run_case_id, reviewer_id, verdict_status, finding, note, created_at")
        .in("run_case_id", rows.map((c) => c.id))
        .order("created_at", { ascending: false })
    : { data: null };

  const reviews: VerdictReview[] = (reviewRows ?? []).map((r) => ({
    id: r.id as string,
    runCaseId: r.run_case_id as string,
    reviewerId: r.reviewer_id as string,
    verdictStatus: r.verdict_status as VerdictReview["verdictStatus"],
    finding: r.finding as VerdictReview["finding"],
    note: r.note as string,
    createdAt: r.created_at as string,
  }));
  const currentReviews = latestReviews(reviews);
  const reviewAlignment = alignment(currentReviews.values());

  const report = reportRows?.[0] ?? null;
  const earlierReports = (reportRows ?? []).slice(1);
  // Reviews the latest report does not carry — the only reason to issue another.
  const undisclosedReviews = report && !report.revoked_at
    ? reviews.filter((r) => r.createdAt > (report.created_at as string)).length
    : 0;
  const applied = withFindingsApplied(
    rows.map((c) => ({ runCaseId: c.id as string, status: c.status as "pass" | "fail" | "error" })),
    currentReviews,
  );

  // Map the policy a proposal produced to its version number, so an approved change
  // can say what it became rather than showing an opaque id.
  const producedIds = [
    ...(proposals ?? []).map((p) => p.resulting_policy_id),
    ...(retestRows ?? []).map((r) => r.policy_id),
  ].filter(Boolean) as string[];
  const { data: producedPolicies } = producedIds.length
    ? await db.from("policies").select("id, version").in("id", [...new Set(producedIds)])
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
      askedVia: (p.api_keys as { name?: string } | null)?.name ?? null,
    });
    proposalsByCase.set(p.run_case_id as string, list);
  }

  const retestsByCase = new Map<string, Retest[]>();
  for (const r of retestRows ?? []) {
    const list = retestsByCase.get(r.run_case_id as string) ?? [];
    list.push({
      id: r.id as string,
      status: r.status as Retest["status"],
      policyVersion: versionOf.get(r.policy_id as string) ?? null,
      rationale: (r.rationale as string | null) ?? null,
      error: (r.error as string | null) ?? null,
      createdAt: r.created_at as string,
    });
    retestsByCase.set(r.run_case_id as string, list);
  }

  // Which runs this one can honestly be compared with: the same agent and the same
  // suite. Comparing across suites would produce a fixed/broken list out of scenarios
  // that were never the same scenarios — a difference that says nothing about the
  // agent. The selector therefore cannot offer one.
  const { data: comparableRuns } = settled
    ? await db
        .from("runs")
        .select("id, created_at, policy_id")
        .eq("agent_id", run.agent_id)
        .eq("suite_id", run.suite_id)
        .eq("status", "completed")
        .neq("id", id)
        .order("created_at", { ascending: false })
        .limit(20)
    : { data: null };

  // The baseline the run was measured from, unless the operator picked another — and
  // only if that one is genuinely comparable.
  const requested = compare && (comparableRuns ?? []).some((r) => r.id === compare) ? compare : null;
  const baselineRunId = requested ?? (run.baseline_run_id as string | null);

  let comparison: ReturnType<typeof compareRuns> | null = null;
  let baselinePolicyVersion: number | null = null;
  if (settled && baselineRunId && rows.length) {
    const { data: before } = await db
      .from("run_cases").select("case_id, status").eq("run_id", baselineRunId);
    if (before?.length) {
      comparison = compareRuns(
        before.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
        rows.map((c) => ({ caseId: c.case_id as string, status: c.status as "pass" | "fail" | "error" })),
      );
      const { data: beforeRun } = await db
        .from("runs").select("policy_id").eq("id", baselineRunId).maybeSingle();
      const { data: beforePolicy } = beforeRun
        ? await db.from("policies").select("version").eq("id", beforeRun.policy_id).maybeSingle()
        : { data: null };
      baselinePolicyVersion = (beforePolicy?.version as number | undefined) ?? null;
    }
  }

  // Which of the moved scenarios have moved before with nothing changed. Only asked
  // when there is a comparison to annotate, and only from runs up to this one, so the
  // answer on this page matches what a report sealed from this run would say.
  const stability = comparison
    ? await loadStability({
        client: db, agentId: run.agent_id as string, suiteId: run.suite_id as string,
        asOf: run.created_at as string,
      })
    : new Map();
  const unstableMoved = comparison ? unstableInComparison(comparison, stability) : [];

  // What an independent read of the customer's system showed, per case. Its own
  // table, so its own query — and the operator needs it most: a case that failed
  // because the system of record disagreed reads like an ordinary failure until you
  // can see what was looked at.
  const { data: observationRows } = rows.length
    ? await db
        .from("evidence_observations")
        .select("run_case_id, status, detail, connector, connector_version, mode, latency_ms")
        .in("run_case_id", rows.map((c) => c.id as string))
    : { data: [] };

  const observationByCase = new Map(
    (observationRows ?? []).map((o) => [
      o.run_case_id as string,
      {
        status: o.status as "confirmed" | "contradicted" | "unavailable",
        detail: o.detail as string,
        connector: o.connector as string,
        connectorVersion: o.connector_version as string,
        mode: o.mode as string,
        latencyMs: (o.latency_ms as number | null) ?? null,
      },
    ]),
  );

  // From the suite, so a scenario that never ran still counts as having asked for proof.
  const requiresEvidence = new Set(
    suiteCases.filter((c) => c.effect).map((c) => c.id as string),
  );

  const statuses = rows.map((c) => ({
    status: c.status as "pass" | "fail" | "error",
    category: c.category as string,
    severity: c.severity as string,
    // Carried so coverage can separate a deadlocked verdict from a dead endpoint.
    agreement: (c.judge_agreement as string | null) ?? null,
    // ...and an unverifiable action from both of them.
    evidenceGap: (c.evidence_gap as string | null) ?? null,
    // Counts, not the strings: a fail that names no unmet assertion is a verdict with
    // no reason attached, and resolution coverage has to see that.
    assertionCount: asStrings(c.assertions).length,
    failedAssertionCount: resolveAssertions(asStrings(c.assertions), asStrings(c.failed_assertions)).length,
    requiresEvidence: requiresEvidence.has(c.case_id as string),
    settledBy: (c.settled_by as string | null) ?? null,
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
    rawExpiredAt: (c.raw_expired_at as string | null) ?? null,
    rawSha256: (c.raw_sha256 as string | null) ?? null,
    // Null on every single-message scenario and on every row stored before 0032.
    transcript: Array.isArray(c.transcript) ? (c.transcript as Array<{ role: "customer" | "agent"; content: string; simulated?: boolean; model?: string }>) : null,
    rationale: (c.rationale as string | null) ?? null,
    error: (c.error as string | null) ?? null,
    judgeModel: (c.judge_model as string | null) ?? null,
    judgeAgreement: (c.judge_agreement as string | null) ?? null,
    // Which vendors actually voted. Stored since 0008 and never read: two votes from
    // one vendor's own model family were being shown as "confirmed by a second model".
    judgeVotes: Array.isArray(c.judge_votes) ? (c.judge_votes as CaseRow["judgeVotes"]) : [],
    // Normalised on the server, from the blob stored verbatim. The operator could
    // not see the agent's steps at all before this — which meant the evidence that
    // decides an effect case was invisible to the person inspecting it.
    trajectory: normaliseTrajectory(c.tool_activity),
    observation: observationByCase.get(c.id as string) ?? null,
    evidenceGap: (c.evidence_gap as string | null) ?? null,
    latencyMs: (c.latency_ms as number | null) ?? null,
  }));

  // The diagnosis controls are server-rendered per case and handed to the client
  // matrix as slots, so the server actions they submit to stay server actions.
  const diagnosis: Record<string, React.ReactNode> = {};
  for (const c of rows) {
    const forCase = proposalsByCase.get(c.id as string) ?? [];
    const caseReviews: ReviewEntry[] = reviews
      .filter((r) => r.runCaseId === c.id)
      .map((r) => ({ ...r, mine: r.reviewerId === viewerId }));
    // Review is offered on passes too: a false pass is the verdict a person most needs
    // to be able to dispute. Diagnosis and retest stay on the ones that did not pass.
    diagnosis[c.id as string] = (
      <>
        {c.status !== "pass" && (
          <>
            {c.raw_expired_at ? (
              // Not a button that can only refuse: say why, and what works instead.
              <p className="text-sm leading-relaxed text-ink-soft">
                A diagnosis reads the agent&rsquo;s reply, which was removed under this workspace&rsquo;s retention
                setting. Retest the scenario to get a fresh one.
              </p>
            ) : (
              <DiagnoseButton runCaseId={c.id as string} hasProposal={forCase.length > 0} />
            )}
            {forCase.map((p) => (
              <ProposalCard key={p.id} proposal={p} />
            ))}
            <RetestButton runCaseId={c.id as string} />
            <RetestHistory retests={retestsByCase.get(c.id as string) ?? []} />
          </>
        )}
        {settled && (
          <>
            <ReviewHistory reviews={caseReviews} />
            <ReviewVerdict runCaseId={c.id as string} status={c.status as "pass" | "fail" | "error"} />
          </>
        )}
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
          {/* The settled view's heading lives in the scorecard; this one had none, so a
              screen reader landing on a run in progress had nothing to orient by. */}
          <h1 className="type-h1 min-w-0 break-words">{agent?.name ?? "Agent"}</h1>
          <p className="mt-1 type-body text-ink-soft">{suite ? `${suite.name} v${suite.version}` : "Suite"}</p>
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
              startedBy={startedBy}
            />
          </div>

          {/* How often the automated verdicts matched a person who read the transcript —
              LangSmith calls it the alignment score. Counted only over verdicts that were
              verdicts: a person settling a disputed case is filling a gap, not agreeing
              with the grader, and is counted separately. Changes no other number. */}
          {currentReviews.size > 0 && (
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              {reviewAlignment.rate !== null && (
                <>
                  A person reviewed {reviewAlignment.agreed + reviewAlignment.disagreed} automated{" "}
                  {reviewAlignment.agreed + reviewAlignment.disagreed === 1 ? "verdict" : "verdicts"} in this run
                  and agreed with {reviewAlignment.agreed}
                  {reviewAlignment.disagreed > 0 && (
                    <>, <strong className="font-semibold text-fail-text">disagreed with {reviewAlignment.disagreed}</strong></>
                  )}
                  .{" "}
                </>
              )}
              {reviewAlignment.resolvedGaps > 0 && (
                <>
                  {reviewAlignment.resolvedGaps} {reviewAlignment.resolvedGaps === 1 ? "scenario" : "scenarios"} with
                  no automated result {reviewAlignment.resolvedGaps === 1 ? "was" : "were"} given a finding by a
                  person.{" "}
                </>
              )}
              Reviews sit beside the verdicts and change no count or grade.
              {applied.changed > 0 && (
                <>
                  {" "}Read with your findings in place of the verdicts they dispute, this run would have{" "}
                  {applied.passed} passed, {applied.failed} failed
                  {applied.noVerdict > 0 && <> and {applied.noVerdict} without a result</>} — your own reading,
                  shown for comparison, not a score.
                </>
              )}
            </p>
          )}
          {undisclosedReviews > 0 && <ReissueReport runId={run.id} pending={undisclosedReviews} />}
          {/* Read from the stored report rather than from the action's reply: the form
              unmounts once nothing is left to disclose, and its confirmation with it. */}
          {undisclosedReviews === 0 && report?.disclosed && (
            <p className="mt-3 text-sm leading-relaxed text-ink-soft">
              The newest report discloses the review recorded up to{" "}
              <time dateTime={report.disclosed as string} className="tnum">
                {String(report.disclosed).slice(0, 16).replace("T", " ")} UTC
              </time>
              , beside the verdicts it concerns.
            </p>
          )}
          {earlierReports.length > 0 && (
            <p className="mt-3 text-xs leading-relaxed text-ink-faint">
              The button below opens the newest report for this run. Earlier ones stay exactly as issued:{" "}
              {earlierReports.map((r, i) => (
                <span key={r.token as string}>
                  {i > 0 && ", "}
                  <Link href={`/report/${r.token}`} className="underline underline-offset-2 hover:text-ink">
                    issued {String(r.created_at).slice(0, 10)}
                  </Link>
                  {r.revoked_at ? " (revoked)" : ""}
                </span>
              ))}
              .
            </p>
          )}

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {report?.token && (
              <Link
                href={`/report/${report.token}`}
                className="inline-flex items-center gap-2 rounded-control bg-ink px-4 py-2 text-sm font-medium text-on-ink transition-all duration-150 hover:bg-ink-hover active:scale-[0.98]"
              >
                Open the client report
              </Link>
            )}
            {report?.token && (
              <Menu
                label="Export"
                triggerClassName="border border-line-strong bg-surface px-3 py-2 text-ink hover:bg-sunken"
                panelClassName="w-72"
              >
                {/* Every format goes through the same token gate as the page, so an
                    export stops working the moment the link is revoked. */}
                <a href={`/api/reports/${report.token}/export?format=md`} className={menuItemClass} download>
                  <span className="block font-medium">Markdown</span>
                  <span className="block text-xs text-ink-faint">The whole report as text, with its hash.</span>
                </a>
                <a href={`/api/reports/${report.token}/export?format=csv`} className={menuItemClass} download>
                  <span className="block font-medium">CSV</span>
                  <span className="block text-xs text-ink-faint">Coverage, obligations and findings as a table.</span>
                </a>
                <a href={`/api/reports/${report.token}/export?format=json`} className={menuItemClass} download>
                  <span className="block font-medium">JSON</span>
                  <span className="block text-xs text-ink-faint">The sealed data and its hash, so anyone can verify a copy.</span>
                </a>
                <a href={`/api/reports/${report.token}/export?format=junit`} className={menuItemClass} download>
                  <span className="block font-medium">JUnit XML</span>
                  <span className="block text-xs text-ink-faint">For CI test reporters. Failed, no result and not run stay distinct.</span>
                </a>
                <a href={`/report/${report.token}?print=1`} target="_blank" rel="noreferrer" className={menuItemClass}>
                  <span className="block font-medium">PDF</span>
                  <span className="block text-xs text-ink-faint">Opens the report; print it to PDF from the browser.</span>
                </a>
              </Menu>
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
              <div className="flex items-center"><h2 className="type-h2">By category</h2><Help label="Categories">
                  The same results grouped by the kind of behaviour tested — identity checks, refunds,
                  attacks and so on — so you can see where the agent is weak.
                </Help></div>
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
            <div className="flex items-center"><h2 className="type-h2">Scenarios</h2><Help label="Scenarios">
                Every test in this run. Passed and failed are verdicts; &ldquo;no result&rdquo; means the agent
                errored, the grading models could not agree, or a claimed action could not be checked — never
                counted as a pass. Open one to read the exchange, ask for a diagnosis, retest it or record your own finding.
              </Help></div>
            {caseRows.length === 0 ? (
              <div className="mt-3">
                <EmptyState title="Nothing was graded">
                  This run produced no gradable result, so there is nothing to diagnose.
                </EmptyState>
              </div>
            ) : (
              <div className="mt-3 rounded-panel border border-line bg-surface p-3 shadow-card sm:p-4">
                <CaseTable
                  cases={
                    // The regression lens needs the comparison the ribbon below already
                    // computed. Derived here rather than in the matrix so both read the
                    // same list — two independent notions of "newly broken" on one page
                    // is how a reviewer ends up trusting the wrong one.
                    comparison
                      ? caseRows.map((c) => ({
                          ...c,
                          regression: comparison!.newFailures.includes(c.caseId),
                        }))
                      : caseRows
                  }
                  diagnosis={diagnosis}
                />
              </div>
            )}
          </section>

          {/* ----------------------------------------------- tier 4: comparison */}
          {/* Shown whenever there is anything to compare against, not only when this
              run recorded a baseline. Gating the whole section on an existing
              comparison meant a run started on its own could never begin one, even
              with comparable runs sitting right there. */}
          {(comparison || (comparableRuns ?? []).length > 0) && (
            <Reveal className="mt-10">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center"><h2 className="type-h2">Compared with another run</h2><Help label="Comparison">
                    Scenario by scenario against an earlier run of the same suite: what got fixed, what still
                    fails, what newly broke. A scenario that already flipped on its own under one policy is flagged,
                    so a coin flip is not mistaken for a regression.
                  </Help></div>
                  {(comparableRuns ?? []).length > 0 && (
                    <BaselinePicker
                      runId={id}
                      current={baselineRunId}
                      placeholder={baselineRunId === null}
                      options={(comparableRuns ?? []).map((r) => ({
                        id: r.id as string,
                        label: new Date(r.created_at as string).toISOString().slice(0, 16).replace("T", " "),
                      }))}
                    />
                  )}
                </div>
                {comparison ? (
                  <>
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

                    {/* A regression and a coin flip look identical from two runs. These
                        scenarios have passed and failed before under one policy version,
                        so their movement here is not, on its own, evidence about the
                        change. They stay in their lists — hiding a real regression would
                        be the worse error — and are named here instead. */}
                    {unstableMoved.length > 0 && (
                      <div className="mt-3 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm leading-relaxed text-warning-text">
                        <p className="font-medium">
                          {unstableMoved.length === 1 ? "One of these has" : `${unstableMoved.length} of these have`} changed
                          verdict before with the policy unchanged.
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {unstableMoved.map((id) => {
                            const s = stability.get(id)!;
                            return (
                              <li key={id}>
                                <span className="type-mono">{id}</span> — passed {s.passes} and failed {s.fails} of{" "}
                                {s.runs} earlier runs under one policy version. Rerun before treating its
                                movement as caused by this change.
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {comparison.missingFromCurrent.length > 0 && (
                      <p className="mt-3 text-sm text-warning-text">
                        Coverage lost since the baseline: {comparison.missingFromCurrent.join(", ")}.
                      </p>
                    )}
                  </>
                ) : (
                  <p className="mt-1 type-body text-ink-soft">
                    This run was not measured against a baseline. Pick one above to see
                    what changed — only runs of this suite against this agent are offered,
                    because anything else would report scenarios as fixed or broken that
                    were never the same scenarios.
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
