import { describeTiming } from "@/lib/schedules/cadence.ts";
import { FixtureNote } from "@/components/ui/fixture-note.tsx";
import { isNoveraFixture } from "@/lib/agents/environment.ts";
import type { AgentConfig } from "@/lib/agents/types.ts";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireWorkspace } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { rerunFrom } from "@/lib/workflow/actions.ts";
import { RefusableForm } from "@/components/ui/refusable-form.tsx";
import { noVerdictRow, repairFor } from "@/lib/evidence/repair.ts";
import { readinessOf, READINESS_LABEL } from "@/lib/report/readiness.ts";
import type { ReportPayload } from "@/lib/report/payload.ts";
import { ReadinessPanel } from "./readiness.tsx";
import { DELTA_CAUSE_SENTENCE, DELTA_LABEL, type DeltaCategory } from "@/lib/evidence/compare.ts";
import { comparableRuns, loadComparison, localeOf } from "@/lib/evidence/comparison-loader.ts";
import { compositionFromManifest } from "@/lib/report/manifest.ts";
import { extensionSentence } from "@/lib/report/seal.ts";
import { gradersMovedNote } from "@/lib/evidence/graders-moved.ts";
import { loadStability } from "@/lib/evidence/stability-history.ts";
import { alignment, latestReviews, withFindingsApplied, type VerdictReview } from "@/lib/evidence/reviews.ts";
import { ReviewVerdict, ReviewHistory, ReissueReport, type ReviewEntry } from "./review.tsx";
import { unstableInComparison } from "@/lib/evidence/stability.ts";
import { coverage, coverageByCategory } from "@/lib/evidence/coverage.ts";
import { categoryMeta } from "@/lib/evidence/categories.ts";
import { gradeRun } from "@/lib/evidence/grade.ts";
import { gradingHealth } from "@/lib/evidence/grading-health.ts";
import { independenceOf } from "@/lib/judge/independence.ts";
import { obligationLabel } from "@/lib/report/payload.ts";
import { normaliseTrajectory } from "@/lib/agents/trajectory.ts";
import { resolveAssertions } from "@/lib/judge/parse.ts";
import { Help } from "@/components/ui/help.tsx";
import { Card, Badge, EmptyState } from "@/components/ui/primitives.tsx";
import { Menu } from "@/components/ui/menu.tsx";
import { menuItemClass } from "@/components/ui/menu-item.ts";
import { SubmitButton } from "@/components/ui/button.tsx";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { LiveRun } from "./live.tsx";
import { RunActivity, RunOverview } from "./overview.tsx";
import { TabNav } from "@/components/ui/page.tsx";
import { Scorecard, type Corroboration } from "./scorecard.tsx";
import { CaseTable, CategoryCard, type CaseRow } from "./case-table.tsx";
import { BaselinePicker } from "./baseline-picker.tsx";
import { OtherWorkspace } from "@/components/shell/other-workspace.tsx";
import { SealInspector } from "@/components/ui/seal-inspector.tsx";
import { CLIENT_EXPLAINS, explainEntries } from "@/lib/explainability/entries.ts";
import { BadgeShare } from "@/components/ui/badge-share.tsx";
import { badgeShareFor } from "@/lib/report/badge.ts";
import { can } from "@/lib/auth/permissions.ts";
import { NOVERA_ATTRIBUTION, SEAL_ATTRIBUTION, sealContents } from "@/lib/report/seal.ts";
import { DiagnoseButton, ProposalCard, RetestHistory, type Proposal, type Retest } from "./diagnose.tsx";
import { TryScenarioAlone } from "@/components/ui/try-scenario-alone.tsx";
import { clientSummary } from "@/lib/report/client-summary.ts";
import { CANONICAL_HOST } from "@/lib/net/canonical-host.ts";
import { DeliverableBar } from "./deliverable-bar.tsx";
import { deliverableFor } from "./deliverable.ts";
import { readClock } from "@/lib/workflow/stalled.ts";
import { buildReportGuide, guideFactsFromRun } from "@/lib/explainability/report-guide.ts";
import { ReportGuideBox } from "@/components/ui/report-guide.tsx";

export const metadata: Metadata = { title: "Run · Novera" };
export const dynamic = "force-dynamic";

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

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
  searchParams: Promise<{ compare?: string; tab?: string; case?: string; lens?: string; verdict?: string; severity?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { compare } = sp;
  // Tabs are addresses. A link that names a scenario, a lens or a verdict lands on Cases; one
  // that names a baseline lands on Comparison — so every existing link still arrives where it meant.
  const TABS = ["overview", "cases", "comparison", "evidence", "activity"] as const;
  type Tab = (typeof TABS)[number];
  const tab: Tab = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as Tab)
    : sp.case || sp.lens || sp.verdict || sp.severity ? "cases" : compare ? "comparison" : "overview";
  const { user: viewer, workspace: activeWorkspace, role, context } = await requireWorkspace();
  const viewerId = viewer.id;
  const db = await sessionClient();

  const { data: run } = await db
    .from("runs")
    .select(
      "id, workspace_id, status, agent_id, policy_id, suite_id, baseline_run_id, error, created_at, started_at, finished_at, pass_threshold, judge_model, schedule_id, api_key_id, manifest, lease_until",
    )
    .eq("id", id)
    .maybeSingle();
  if (!run) notFound();
  if (run.workspace_id !== activeWorkspace.id) {
    const there = context.memberships.find((m) => m.workspace.id === run.workspace_id);
    if (!there) notFound();
    return <OtherWorkspace thing="run" workspace={there.workspace.name} workspaceId={there.workspace.id} next={`/runs/${id}`} />;
  }

  const [{ data: agent }, { data: policy }, { data: suite }, { data: reportRows }, { data: schedule }, { data: apiKey }, { data: newestPolicy }] = await Promise.all([
    db.from("agents").select("name, config").eq("id", run.agent_id).maybeSingle(),
    db.from("policies").select("version").eq("id", run.policy_id).maybeSingle(),
    db.from("suites").select("name, key, workspace_id, version, cases, approval, provenance").eq("id", run.suite_id).maybeSingle(),
    // Newest first: a run can carry a reissue that discloses human review, and a
    // single-row read of more than one report returns nothing at all.
    db.from("reports").select("token, created_at, revoked_at, expires_at, content_hash, payload, disclosed:payload->human_review->>as_of").eq("run_id", id)
      .order("created_at", { ascending: false }),
    run.schedule_id
      ? db.from("run_schedules").select("cadence, hour_utc, weekday").eq("id", run.schedule_id).maybeSingle()
      : Promise.resolve({ data: null }),
    run.api_key_id
      ? db.from("api_keys").select("name").eq("id", run.api_key_id).maybeSingle()
      : Promise.resolve({ data: null }),
    // What a retest would run against now, so the button can name it.
    db.from("policies").select("version").eq("agent_id", run.agent_id).order("version", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const startedBy = schedule
    ? `started by the schedule “${describeTiming({
        cadence: schedule.cadence as "daily" | "weekly", hourUtc: schedule.hour_utc as number, weekday: schedule.weekday as number | null,
      })}”`
    : apiKey
      ? `started by the API key “${apiKey.name as string}”`
      : null;

  // A Suite Builder scan of unapproved drafts: never sealed as a report (0056), never rerun
  // from here, and said so above everything else on the page.
  const exploratory = suite?.approval === "exploratory";
  const scanBuild = exploratory ? ((suite?.provenance as { build_id?: string } | null)?.build_id ?? null) : null;
  const suiteCases = Array.isArray(suite?.cases) ? (suite.cases as Array<Record<string, unknown>>) : [];
  const plannedCases = suiteCases.length;
  const settled = run.status === "completed" || run.status === "aborted";

  // A run in flight: its newest recorded scenario, which with its own timestamps says whether it
  // has stopped moving (src/lib/workflow/stalled.ts). Read once here; the live view polls after.
  const { data: newestCase } = settled
    ? { data: null }
    : await db.from("run_cases").select("created_at").eq("run_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const renderedAt = readClock();

  // While the run is in flight the live view owns the page: it reads the same rows,
  // but streams them. Once the run has settled the server renders them instead, so
  // the decision controls below are here on first paint rather than after a poll.
  const rows = settled
    ? (
        await db
          .from("run_cases")
          .select(
            "id, case_id, category, obligation, severity, status, input, expected, assertions, failed_assertions, response_text, rationale, error, latency_ms, judge_model, judge_agreement, judge_votes, evidence_gap, settled_by, tool_activity, transcript, raw_expired_at, raw_sha256, judge_attempts",
          )
          .eq("run_id", id)
          .order("case_id")
      ).data ?? []
    : [];

  const { data: proposals } = settled && rows.length
    ? await db
        .from("diagnoses")
        .select("id, run_case_id, analysis, quoted_old, proposed_new, risks, status, created_at, decided_at, resulting_policy_id, api_keys(name)")
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
  // Whether the newest report is something to hand a client, from what is stored.
  const readiness = report?.payload
    ? readinessOf({
        report: {
          payload: report.payload as unknown as ReportPayload, content_hash: report.content_hash as string,
          expires_at: report.expires_at as string, revoked_at: (report.revoked_at as string | null) ?? null,
        },
        undisclosedReviews,
      })
    : null;
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

  // Which runs this one can honestly be compared with: the same agent and the same suite —
  // at this version or another, since a scenario is compared only with an identical
  // definition of itself (src/lib/evidence/compare.ts). Another suite would produce a
  // fixed/broken list out of scenarios that were never the same scenarios, so the selector
  // cannot offer one.
  const comparable = settled && suite
    ? await comparableRuns(db, { id, agentId: run.agent_id as string, locale: localeOf(run.manifest) }, { key: suite.key as string, owner: (suite.workspace_id as string | null) ?? null })
    : [];
  // The newest completed run before this one: what "Compare with previous run" opens.
  const previousRun = comparable.find((r) => r.createdAt < (run.created_at as string)) ?? null;

  // The baseline the run was measured from, unless the operator picked another — and
  // only if that one is genuinely comparable.
  const requested = compare && comparable.some((r) => r.id === compare) ? compare : null;
  const baselineRunId = requested ?? (run.baseline_run_id as string | null);

  // One loader for this tab and /runs/compare, so the two can never disagree. This run's
  // rows are handed over rather than read again.
  const loadedComparison = settled && baselineRunId && rows.length
    ? await loadComparison({
        db, workspaceId: activeWorkspace.id, baseId: baselineRunId, targetId: id,
        known: { runId: id, rows: rows as Array<Record<string, unknown>>, observations: observationRows ?? [] },
      })
    : null;
  const deltas = loadedComparison?.ok ? loadedComparison.deltas : null;
  const comparisonRefused = loadedComparison && !loadedComparison.ok ? loadedComparison.sentence : null;
  const idsIn = (...categories: DeltaCategory[]) =>
    (deltas?.deltas ?? []).filter((d) => categories.includes(d.category)).map((d) => d.caseId).sort((a, b) => a.localeCompare(b, "en", { numeric: true }));
  // Every list on this page reads the deltas — the overview's counts, the Cases lens and this
  // tab — so a verdict that moved on an identical reply is nowhere called fixed or broken.
  const comparison = deltas
    ? {
        fixed: idsIn("fixed"),
        newFailures: idsIn("regressed"),
        persistentFailures: idsIn("persistent_failure"),
        nowErrored: idsIn("no_result_now"),
        movedSameReply: idsIn("verdict_moved_same_reply"),
      }
    : null;

  // The scenarios left out of "newly broken" because only the graders moved, and whether the sealed
  // report (written when the run finished, never edited) counts them differently.
  const gradersMoved = deltas
    ? gradersMovedNote({
        deltas: deltas.deltas,
        baselineRunId,
        sealedComparison: (report?.payload as unknown as ReportPayload | null | undefined)?.comparison ?? null,
      })
    : null;

  // Which of the moved scenarios have moved before with nothing changed. Only asked
  // when there is a comparison to annotate, and only from runs up to this one, so the
  // answer on this page matches what a report sealed from this run would say.
  // Loaded for every run, not only a comparison: a scenario whose verdict moves on its
  // own says so in its own detail too.
  const stability = await loadStability({
    client: db, agentId: run.agent_id as string, suiteId: run.suite_id as string,
    asOf: run.created_at as string,
  });
  const unstableMoved = comparison ? unstableInComparison(comparison, stability) : [];

  // Why each moved scenario moved, and what else differed between the two runs.
  const moves = (deltas?.deltas ?? []).filter((d) => d.cause !== null && d.category !== "redefined");
  const otherChanges = loadedComparison?.ok ? loadedComparison.config.changes : [];

  // From the suite, so a scenario that never ran still counts as having asked for proof.
  const requiresEvidence = new Set(
    suiteCases.filter((c) => c.effect).map((c) => c.id as string),
  );

  const statuses = rows.map((c) => ({
    status: c.status as "pass" | "fail" | "error",
    error: (c.error as string | null) ?? null,
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
      if (a === "agreed") {
        acc.agreed += 1;
        // Derived from the votes, as the sealed report does: two models of one vendor
        // agreeing is corroboration, but a weaker kind, and the line says how much.
        const votes = Array.isArray(c.judge_votes) ? (c.judge_votes as Array<{ model: string; status: "pass" | "fail" | "error" }>) : [];
        if (independenceOf(votes) === "single-vendor") acc.sameVendor += 1;
      }
      else if (a === "majority") acc.settled += 1;
      else if (a === "unconfirmed") acc.unconfirmed += 1;
      else if (a === "unresolved") acc.unresolved += 1;
      else if (c.status === "pass" || c.status === "fail") {
        if (c.settled_by === "deterministic") acc.rules += 1;
        else if (c.settled_by === "read_back") acc.readBack += 1;
      }
      return acc;
    },
    { agreed: 0, sameVendor: 0, settled: 0, unconfirmed: 0, unresolved: 0, rules: 0, readBack: 0 },
  );

  const scenarioById = new Map(suiteCases.map((c) => [c.id as string, c]));
  const dutyRefsByCase = new Map(suiteCases.map((c) => [
    c.id as string,
    Array.isArray(c.duty_refs) ? (c.duty_refs as unknown[]).filter((d): d is string => typeof d === "string") : [],
  ]));
  // From the suite version the run froze, which is immutable: the rules this scenario
  // was held to, whole-conversation and per-turn.
  const ruleCountByCase = new Map(suiteCases.map((c) => [
    c.id as string,
    (Array.isArray(c.checks) ? c.checks.length : 0)
      + (Array.isArray(c.turn_checks)
        ? (c.turn_checks as Array<{ checks?: unknown }>).reduce((n, t) => n + (Array.isArray(t?.checks) ? t.checks.length : 0), 0)
        : 0),
  ]));
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
    dutyRefs: dutyRefsByCase.get(c.case_id as string) ?? [],
    instability: stability.get(c.case_id as string) ?? null,
    settledBy: (c.settled_by as string | null) ?? null,
    ruleCount: ruleCountByCase.get(c.case_id as string) ?? 0,
    // Why there is no verdict, and whether a retest could repeat something the agent did.
    repair: repairFor(noVerdictRow(c, {
      observationStatus: observationByCase.get(c.id as string)?.status ?? null,
      scenario: scenarioById.get(c.case_id as string) ?? null,
      toolCalls: normaliseTrajectory(c.tool_activity).filter((e) => e.type === "tool_call").length,
    })),
  }));

  // The diagnosis controls are server-rendered per case and handed to the client
  // matrix as slots, so the server actions they submit to stay server actions.
  const newestVersion = (newestPolicy?.version as number | undefined) ?? null;
  const diagnosis: Record<string, React.ReactNode> = {};
  for (const c of rows) {
    const forCase = proposalsByCase.get(c.id as string) ?? [];
    const caseReviews: ReviewEntry[] = reviews
      .filter((r) => r.runCaseId === c.id)
      .map((r) => ({ ...r, mine: r.reviewerId === viewerId }));
    // Review is offered on passes too: a false pass is the verdict a person most needs
    // to be able to dispute. Retest stays on the ones that did not pass; diagnosis only
    // on failures — a scenario with no result has no failure for a model to explain.
    // The newest approved change for this scenario carries the steps that test it, so the
    // retest and the rerun appear where the decision was made, with this case and run.
    const approvedLast = forCase.filter((p) => p.status === "approved")
      .sort((a, b) => (b.decidedAt ?? "").localeCompare(a.decidedAt ?? ""))[0];
    const retestedSince = approvedLast?.resultingPolicyVersion
      ? (retestsByCase.get(c.id as string) ?? []).find((r) => (r.policyVersion ?? 0) >= approvedLast.resultingPolicyVersion!)
      : undefined;
    diagnosis[c.id as string] = (
      <>
        {c.status !== "pass" && (
          <>
            {c.status !== "fail" ? null : c.raw_expired_at ? (
              // Not a button that can only refuse: say why, and what works instead.
              <p className="text-sm leading-relaxed text-ink-soft">
                A diagnosis reads the agent&rsquo;s reply, which was removed under this workspace&rsquo;s retention
                setting. Try the scenario alone for a fresh one.
              </p>
            ) : (
              <DiagnoseButton runCaseId={c.id as string} hasProposal={forCase.length > 0} />
            )}
            {forCase.map((p) => (
              <ProposalCard
                key={p.id}
                proposal={p}
                next={p.id === approvedLast?.id ? (
                  <>
                    <TryScenarioAlone target={{ runCaseId: c.id as string }} newestPolicyVersion={newestVersion} />
                    {retestedSince && (
                      <p className="mt-2 text-xs text-ink-soft">
                        Checked alone against policy v{retestedSince.policyVersion}:{" "}
                        {retestedSince.status === "pass" ? "it now passes." : retestedSince.status === "fail" ? "it still fails." : "no verdict."}
                      </p>
                    )}
                    {!exploratory && <RefusableForm action={rerunFrom} className="mt-3 flex flex-wrap items-center gap-3">
                      <input type="hidden" name="runId" value={run.id} />
                      <SubmitButton variant="secondary" size="sm" pendingLabel="Starting…">
                        Rerun the suite and compare with this run
                      </SubmitButton>
                      <span className="text-xs text-ink-faint">A new run of every scenario under the newest policy; it uses one run.</span>
                    </RefusableForm>}
                  </>
                ) : undefined}
              />
            ))}
            {!approvedLast && <TryScenarioAlone target={{ runCaseId: c.id as string }} newestPolicyVersion={newestVersion} />}
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
  const composition = compositionFromManifest(run.manifest);
  const caseIdOf = new Map(rows.map((c) => [c.id as string, c.case_id as string]));
  const suiteLabel = suite ? `${suite.name} v${suite.version}` : "Suite";

  // The seal, as stored: the newest report's digest, or none. Never a placeholder digest.
  const utc = (at: unknown) => (typeof at === "string" ? `${at.slice(0, 16).replace("T", " ")} UTC` : null);
  const reportGone = report?.revoked_at
    ? `This report was withdrawn on ${utc(report.revoked_at)}, so its link and exports no longer answer.`
    : report && new Date(report.expires_at as string) < new Date()
      ? `This report's link expired on ${utc(report.expires_at)}, so its exports no longer answer.`
      : null;
  const sealLine = report
    ? `SHA-256 ${report.content_hash as string} · sealed ${utc(report.created_at)}${report.revoked_at ? ` · withdrawn ${utc(report.revoked_at)}` : ""}`
    : exploratory
      ? "Not sealed: an exploratory scan is never sealed as a report."
      : "Not sealed: no report was sealed for this run.";
  // The embeddable badge: only for a live seal that still holds, to a role that may share reports.
  const badgeShare = report?.content_hash && can(role, "report.export")
    ? badgeShareFor({
        payload: report.payload, content_hash: report.content_hash as string,
        created_at: (report.created_at as string | null) ?? null, revoked_at: (report.revoked_at as string | null) ?? null,
      })
    : null;
  const deliverable = deliverableFor({
    runId: run.id as string,
    runStatus: run.status as string,
    exploratory,
    fixture: Boolean(agent?.config && isNoveraFixture(agent.config as AgentConfig)),
    report: report ? {
      token: report.token as string, content_hash: report.content_hash as string,
      revoked_at: (report.revoked_at as string | null) ?? null, expires_at: report.expires_at as string,
    } : null,
    readiness: readiness?.state ?? null,
    previousRunId: previousRun?.id ?? null,
  });
  // A Suite Builder scan is never rerun from here (0056); a role that cannot start runs is not offered one.
  const mayRerun = !exploratory && can(role, "run.start");
  const compareHere = deliverable.kind !== "share" && previousRun !== null;
  const executed = run.started_at
    ? `Executed ${utc(run.started_at)}${run.finished_at ? ` to ${utc(run.finished_at)}` : ", not finished"} · status ${run.status as string}`
    : `Created ${utc(run.created_at)} · not started · status ${run.status as string}`;
  const sectionName = { overview: "Overview", cases: "Cases", comparison: "Comparison", evidence: "Evidence", activity: "Activity" }[tab];

  return (
    <main className="w-full py-8 text-ink print:py-0">
      {/* Print only. Everything in it is read from the run and report rows; it is outside any
          sealed content (a report's digest covers its payload, never this page). */}
      <PrintRunLine
        className="mb-5 border-b"
        lines={[
          `${agent?.name ?? "Agent"} · ${suiteLabel} · run ${run.id}${settled ? ` · ${sectionName}` : ""}`,
          executed,
        ]}
        seal={sealLine}
        sealed={Boolean(report)}
      />
      <Link href={`/agents/${run.agent_id}`} className="print-hide text-sm text-ink-soft underline-offset-2 hover:underline">
        ← {agent?.name ?? "Agent"}
      </Link>

      {agent?.config && isNoveraFixture(agent.config as AgentConfig) && <FixtureNote className="mt-4" />}

      {exploratory && (
        <div role="note" className="mt-4 rounded-panel border border-warning-border bg-warning-surface px-4 py-3 text-warning-text">
          <p className="font-semibold">Exploratory scan — not a sealed evaluation report</p>
          <p className="mt-1 text-sm">
            This run includes scenarios nobody has approved yet. No report is sealed for it, and a pipeline reads it as
            incomplete. Use it to see what the agent does, then decide each scenario
            {scanBuild ? <> in the <Link href={`/builder/${scanBuild}`} className="font-medium underline underline-offset-2">Suite Builder</Link></> : " in the Suite Builder"} and publish the suite.
          </p>
        </div>
      )}

      {/* What the manifest declared about the suite's composition and language, when either
          differs from an official suite sent in English. */}
      {(composition.extension || composition.locale) && (
        <p className="mt-3 text-sm text-ink-soft">
          {composition.extension && <>{extensionSentence(composition.extension)}. </>}
          {composition.locale && <>{composition.locale.localised} of {composition.locale.of} scenarios sent in {composition.locale.name}; the rest in English.</>}
        </p>
      )}

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
            initialProgress={{
              status: run.status as string,
              createdAt: run.created_at as string,
              startedAt: (run.started_at as string | null) ?? null,
              lastCaseAt: (newestCase?.created_at as string | undefined) ?? null,
              leaseUntil: (run.lease_until as string | null) ?? null,
            }}
            renderedAt={renderedAt}
            mayContinue={can(role, "run.start")}
          />
        </div>
      ) : (
        <>
          {/* --------------------------------------------------- tier 1: grade */}
          <div className="mt-4 print:break-inside-avoid">
            <Scorecard
              grade={grade}
              coverage={runCoverage}
              corroboration={corroboration}
              health={gradingHealth(rows)}
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

          {/* The client deliverable: the report, its link, printing it, its seal and the comparison
              with the previous run — each once on this page (deliverable.ts decides what is offered). */}
          <DeliverableBar
            deliverable={deliverable}
            summary={report?.payload && deliverable.kind === "share"
              ? clientSummary({ payload: report.payload as unknown as ReportPayload, contentHash: report.content_hash as string, origin: `https://${CANONICAL_HOST}`, reportPath: deliverable.reportHref })
              : null}
            extra={report?.token && deliverable.kind === "share" ? (
              <>
                <Menu
                  label="Downloads"
                  triggerClassName="border border-line-strong bg-surface px-3 py-1.5 text-ink hover:bg-sunken"
                  panelClassName="w-72"
                >
                  {/* Every format goes through the same token gate as the page, so a
                      download stops working the moment the link is withdrawn. */}
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
                </Menu>
                {badgeShare && <BadgeShare {...badgeShare} />}
              </>
            ) : undefined}
          />

          {/* Operator actions on the run itself, apart from what is handed to a client. Without the
              bar (no sealed report that still answers), the comparison with the previous run is here. */}
          {(mayRerun || compareHere) && (
            <div className="print-hide mt-4 flex flex-wrap items-center gap-3">
              {mayRerun && (
                <RefusableForm action={rerunFrom}>
                  <input type="hidden" name="runId" value={run.id} />
                  <SubmitButton variant="secondary" size="sm" pendingLabel="Starting…">
                    Rerun and compare against this
                  </SubmitButton>
                </RefusableForm>
              )}
              {compareHere && (
                <ButtonLink variant="secondary" size="sm" href={`/runs/compare?base=${previousRun!.id}&target=${run.id}`}>
                  Compare with previous run
                </ButtonLink>
              )}
            </div>
          )}

          {/* The 60-second guide, read from this run's rows (src/lib/explainability/report-guide.ts). */}
          <ReportGuideBox
            className="mt-4"
            guide={buildReportGuide(guideFactsFromRun({
              coverage: runCoverage, grade, sealed: Boolean(report?.content_hash),
              fixture: Boolean(agent?.config && isNoveraFixture(agent.config as AgentConfig)),
              simulated: caseRows.some((c) => c.transcript?.some((t) => t.simulated)),
              oneGrader: corroboration.unconfirmed,
            }))}
          />

          <div className="print-hide mt-8">
            <TabNav
              label="Run sections"
              current={tab}
              tabs={[
                { key: "overview", label: "Overview", href: `/runs/${id}` },
                { key: "cases", label: "Cases", href: `/runs/${id}?tab=cases`, count: caseRows.length },
                { key: "comparison", label: "Comparison", href: `/runs/${id}?tab=comparison${baselineRunId ? `&compare=${baselineRunId}` : ""}` },
                { key: "evidence", label: "Evidence", href: `/runs/${id}?tab=evidence` },
                { key: "activity", label: "Activity", href: `/runs/${id}?tab=activity` },
              ]}
            />
          </div>

          {tab === "overview" && (
            <RunOverview
              runId={id}
              readiness={readiness ? { label: READINESS_LABEL[readiness.state], state: readiness.state, gap: readiness.checks.find((c) => c.result === "gap")?.detail ?? null } : null}
              findings={caseRows.filter((c) => c.status !== "pass").sort((x, y) => SEVERITY_RANK[x.severity] - SEVERITY_RANK[y.severity] || x.caseId.localeCompare(y.caseId))
                .map((c) => ({ caseId: c.caseId, status: c.status, severity: c.severity, title: c.obligationLabel, category: c.categoryLabel }))}
              comparison={comparison ? { fixed: comparison.fixed.length, newFailures: comparison.newFailures.length, persistentFailures: comparison.persistentFailures.length, nowErrored: comparison.nowErrored.length } : null}
              gradersMoved={gradersMoved}
              canCompare={comparable.length > 0}
              undecided={undecided}
              recorded={caseRows.length}
            />
          )}
          {tab === "overview" && undisclosedReviews > 0 && <ReissueReport runId={run.id} pending={undisclosedReviews} />}

          {tab === "cases" && (
            <>
          {/* ------------------------------------------------ tier 2: categories */}
          {categories.length > 0 && (
            <section className="mt-6">
              <div className="flex items-center"><h2 className="type-h2">By category</h2><Help label="Categories">
                  The same results grouped by the kind of behaviour tested — identity checks, refunds,
                  attacks and so on — so you can see where the agent is weak.
                </Help></div>
              <p className="mt-1 type-body text-ink-soft">
                A percentage can look healthy while the one case that mattered is the one
                that failed, so a failed critical scenario is marked on its category.
              </p>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 print:[&>*]:break-inside-avoid">
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
          <section className="mt-6">
            <div className="flex items-center"><h2 className="type-h2">Scenarios</h2><Help label="Scenarios">
                Every test in this run. Passed and failed are verdicts; &ldquo;no result&rdquo; means the agent
                errored, the grading models could not agree, or a claimed action could not be checked — never
                counted as a pass. Open one to read the exchange, ask for a diagnosis, try it alone or record your own finding.
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
                  explain={explainEntries(CLIENT_EXPLAINS.caseTable)}
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

            </>
          )}

          {tab === "comparison" && (
            <>
          {/* ----------------------------------------------- tier 4: comparison */}
          {/* Shown whenever there is anything to compare against, not only when this
              run recorded a baseline. Gating the whole section on an existing
              comparison meant a run started on its own could never begin one, even
              with comparable runs sitting right there. */}
          {(comparison || comparisonRefused || comparable.length > 0) && (
            <div className="mt-6">
              <section>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex items-center"><h2 className="type-h2">Compared with another run</h2><Help label="Comparison">
                    Scenario by scenario against an earlier run of the same suite: what got fixed, what still
                    fails, what newly broke. A verdict that moved while the agent&apos;s reply stayed identical is
                    counted on its own, never as fixed or broken; a scenario that already flipped on its own under
                    one policy is flagged, so a coin flip is not mistaken for a regression.
                  </Help></div>
                  {comparable.length > 0 && (
                    <BaselinePicker
                      runId={id}
                      current={baselineRunId}
                      placeholder={baselineRunId === null}
                      options={comparable.map((r) => ({
                        id: r.id,
                        label: `${r.createdAt.slice(0, 16).replace("T", " ")}${r.suiteVersion !== null && r.suiteVersion !== suite?.version ? ` · suite v${r.suiteVersion}` : ""}`,
                      }))}
                    />
                  )}
                </div>
                {comparison && deltas ? (
                  <>
                    <p className="mt-1 type-body text-ink-soft">
                      {deltas.definitions.match
                        ? "Both runs covered the same scenarios, defined the same way."
                        : `Partly comparable: the suite changed between the runs, so ${deltas.definitions.identical} scenarios defined identically in both are compared and the rest are listed apart.`}
                      {otherChanges.length === 0 && ` Same policy (v${policy?.version ?? "?"}), graders, rubric and agent configuration.`}
                    </p>
                    {otherChanges.length > 0 && (
                      <ul className="mt-1 space-y-0.5 text-sm text-ink-soft">
                        {otherChanges.map((c) => <li key={c}>{c}</li>)}
                      </ul>
                    )}

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

                    {gradersMoved && (
                      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
                        {gradersMoved.sentence}{gradersMoved.sealedSentence ? ` ${gradersMoved.sealedSentence}` : ""}
                      </p>
                    )}

                    {/* The consensus story: a verdict that moved on a byte-identical reply is the
                        graders moving. It is named here and counted in none of the lists above. */}
                    {comparison.movedSameReply.length > 0 && (
                      <p className="mt-3 rounded-lg border border-line bg-sunken px-3 py-2 text-sm leading-relaxed text-ink-soft">
                        <span className="font-medium text-ink">
                          {comparison.movedSameReply.length === 1 ? "1 verdict" : `${comparison.movedSameReply.length} verdicts`} moved on an identical reply — graders, not the agent:
                        </span>{" "}
                        <span className="type-mono">{comparison.movedSameReply.join(", ")}</span>. Counted neither as fixed nor as broken.
                      </p>
                    )}

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
                                {s.runs} earlier runs under one policy version
                                {s.cause === "graders" ? ", on an identical reply — the graders moved, not the agent" : s.cause === "agent" ? ", with the agent's reply differing" : ""}.
                                Rerun before treating its movement as caused by this change.
                              </li>
                            );
                          })}
                        </ul>
                      </div>
                    )}

                    {moves.length > 0 && (
                      <div className="mt-4">
                        <h3 className="text-sm font-medium">Why each one moved</h3>
                        <p className="mt-0.5 text-xs text-ink-faint">
                          From the fingerprints of the agent&apos;s replies in both runs: a verdict that moved on an identical reply
                          is the graders, never an agent improvement or regression.
                        </p>
                        <ul className="mt-2 space-y-1 text-sm">
                          {moves.map((m) => (
                            <li key={m.caseId}>
                              <span className="type-mono">{m.caseId}</span> <span className="text-ink-faint">{DELTA_LABEL[m.category].toLowerCase()}</span> — {DELTA_CAUSE_SENTENCE[m.cause!]}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {!deltas.definitions.match && (
                      <p className="mt-3 text-sm text-warning-text">
                        Not compared, because the suite changed: {deltas.definitions.redefined} redefined, {deltas.definitions.added} added,{" "}
                        {deltas.definitions.retired} retired. Each is listed side by side.
                      </p>
                    )}

                    <Link
                      href={`/runs/compare?base=${baselineRunId}&target=${id}`}
                      className="print-hide mt-4 inline-block text-sm font-medium text-ink-soft underline-offset-2 hover:text-ink hover:underline"
                    >
                      Open side by side →
                    </Link>
                  </>
                ) : comparisonRefused ? (
                  <p className="mt-1 type-body text-ink-soft">{comparisonRefused}</p>
                ) : (
                  <p className="mt-1 type-body text-ink-soft">
                    This run was not measured against a baseline. Pick one above to see
                    what changed — only runs of this suite against this agent are offered,
                    because anything else would report scenarios as fixed or broken that
                    were never the same scenarios.
                  </p>
                )}
              </section>
            </div>
          )}
              {!(comparison || comparisonRefused || comparable.length > 0) && (
                <p className="mt-6 type-body text-ink-soft">No earlier run of this suite against this agent exists yet, so there is nothing to compare with.</p>
              )}
            </>
          )}

          {tab === "evidence" && (
            <div className="mt-6 space-y-6">
          {readiness && report?.token && (
            <ReadinessPanel explain={explainEntries(CLIENT_EXPLAINS.readiness)} state={readiness.state} label={READINESS_LABEL[readiness.state]} checks={readiness.checks} token={report.token as string} />
          )}

              {report?.content_hash && (
                <div className="print-hide flex flex-wrap items-center gap-3">
                  <SealInspector
                    explain={explainEntries(CLIENT_EXPLAINS.sealInspector)}
                    hash={report.content_hash as string}
                    items={sealContents(report.payload as unknown as ReportPayload)}
                    exportPath={reportGone ? null : `/api/reports/${encodeURIComponent(report.token as string)}/export?format=json`}
                    unavailable={reportGone ?? undefined}
                  />
                  <span className="text-xs text-ink-faint">What the seal covers, and its digest to copy.</span>
                </div>
              )}
              {report && (
                <dl className="grid gap-3 rounded-shell border border-line bg-surface p-5 text-sm sm:grid-cols-2">
                  <div><dt className="text-xs text-ink-faint">Report digest (SHA-256)</dt><dd className="mt-0.5 break-all type-mono text-xs">{report.content_hash as string}</dd></div>
                  <div><dt className="text-xs text-ink-faint">Sealed</dt><dd className="mt-0.5 tnum">{String(report.created_at).slice(0, 16).replace("T", " ")} UTC</dd></div>
                  {run.manifest && <div className="sm:col-span-2"><dt className="text-xs text-ink-faint">Inputs declared before the run</dt><dd className="mt-0.5 text-xs text-ink-soft">Suite version, scenario list, policy version, agent host, judge plan, pass mark and rubric digest were frozen when the run was created, before anything was sent.</dd></div>}
                </dl>
              )}
              <p className="text-sm text-ink-soft">Each scenario&apos;s own evidence — input, reply, tool calls, read-back, rules, every grader&apos;s vote — opens from <Link href={`/runs/${id}?tab=cases`} className="font-medium underline underline-offset-2">Cases</Link>.</p>
            </div>
          )}

          {tab === "activity" && (
            <div className="mt-6 space-y-4">
              <RunActivity events={[
                { at: run.created_at as string, text: `Run created · ${startedBy ?? "in the app"}` },
                ...(run.started_at ? [{ at: run.started_at as string, text: "First scenario sent" }] : []),
                ...(run.finished_at ? [{ at: run.finished_at as string, text: `Finished · ${run.status}` }] : []),
                ...(reportRows ?? []).flatMap((r) => [
                  { at: r.created_at as string, text: "Report sealed" },
                  ...(r.revoked_at ? [{ at: r.revoked_at as string, text: "Report withdrawn" }] : []),
                ]),
                ...(proposals ?? []).flatMap((p) => [
                  { at: p.created_at as string, text: `Diagnosis proposed for ${caseIdOf.get(p.run_case_id as string) ?? "a scenario"}` },
                  ...(p.decided_at ? [{ at: p.decided_at as string, text: `Proposal ${p.status} for ${caseIdOf.get(p.run_case_id as string) ?? "a scenario"}` }] : []),
                ]),
                ...(retestRows ?? []).map((r) => ({ at: r.created_at as string, text: `${caseIdOf.get(r.run_case_id as string) ?? "A scenario"} retested · ${r.status === "error" ? "no result" : r.status}` })),
                ...reviews.map((r) => ({ at: r.createdAt, text: `A person recorded a finding on ${caseIdOf.get(r.runCaseId) ?? "a scenario"} · ${r.finding}` })),
              ]} />
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

            </div>
          )}
        </>
      )}
      <PrintRunLine className="mt-8 border-t" lines={[`Run ${run.id} · ${executed}`]} seal={sealLine} sealed={Boolean(report)} />
    </main>
  );
}

/** The attribution, the run's own timestamps and its seal (or "not sealed"), on paper only. */
function PrintRunLine({ lines, seal, sealed, className }: { lines: string[]; seal: string; sealed: boolean; className: string }) {
  return (
    <div className={`hidden border-line py-3 text-xs leading-relaxed text-ink-soft print:block ${className}`}>
      <p className="font-semibold text-ink">{sealed ? SEAL_ATTRIBUTION : NOVERA_ATTRIBUTION}</p>
      {lines.map((l) => <p key={l} className="mt-1">{l}</p>)}
      <p className="mt-1 break-all font-mono text-ink">{seal}</p>
    </div>
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
