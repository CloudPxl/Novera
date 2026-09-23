import { contentHash, type Json } from "./hash.ts";
import { assertPublishable } from "./redact.ts";
import { compareRuns, type Comparison } from "../evidence/compare.ts";
import type { Coverage, ObligationCoverage, CategoryCoverage } from "../evidence/coverage.ts";
import { gradeRun, meetsThreshold } from "../evidence/grade.ts";
import { independenceOf } from "../judge/independence.ts";
import type { RunCaseRecord } from "../runner/types.ts";

/**
 * Builds the client-facing report payload.
 *
 * This is the only thing a recipient ever sees, so it is built by naming what goes
 * in rather than by stripping what should not. The agent's raw responses, the policy
 * text, the system prompt, provider payloads and internal row ids are simply never
 * read here. `assertPublishable` then fails the build if any of it turns up anyway.
 */
export interface ReportInput {
  client: string;
  agentName: string;
  policyVersion: number;
  runId: string;
  runDate: string;
  environment: string;
  suite: { key: string; version: number; name: string };
  attestation: string | null;
  judge: { source: "trial_free" | "workspace_key" };
  cases: RunCaseRecord[];
  coverage: Coverage;
  byObligation: ObligationCoverage[];
  byCategory: CategoryCoverage[];
  /** The pass mark this run was measured against, recorded on the run itself. */
  passThreshold: number;
  /** Wall time from first case to last, when both timestamps were recorded. */
  durationMs: number | null;
  baseline?: { runId: string; policyVersion: number; cases: Array<{ caseId: string; status: RunCaseRecord["status"] }> };
  /** Verbatim strings that must not appear in the output (policy body, system prompt). */
  privateMaterial?: string[];
}

export interface BuiltReport {
  payload: Json;
  contentHash: string;
}

const LIMITATIONS =
  "This report records how the named agent behaved on the listed scenarios, under the recorded configuration, on the date shown. It does not cover untested interactions, does not predict future behaviour, and is not a certification or a statement of legal compliance. Obligation codes group the evidence; they do not determine which obligations apply to your organisation.";

const UNCORROBORATED_NOTE =
  "Some verdicts in this run were produced by a single model because a second was unavailable. They are counted in the score and marked as uncorroborated below; rerun the suite for a fully corroborated result.";

const MIXED_GRADING_NOTE =
  "More than one grading model was used in this run, because a provider was unavailable partway through. The verdicts are therefore not uniformly graded. Rerun the suite if you need a single-model result.";

/**
 * More than one model named as grader is now the *normal* outcome, not a fault.
 *
 * Where two models disagree, the model that settles it is recorded as that case's
 * grader — so a healthy consensus run legitimately names two or three. Until this was
 * separated, such a run carried a note telling the client a provider had gone down
 * mid-run, which was simply untrue.
 */
const UNVERIFIABLE_NOTE =
  "Some scenarios expected the agent to perform an action. Where nothing independent of the agent evidenced that the action took place, Novera withheld the pass and recorded the scenario as unverified rather than accepting the agent's own account of it. Those scenarios are excluded from the score and counted in the assurance gap.";

const CONSENSUS_GRADING_NOTE =
  "More than one model is named as grader because some verdicts were settled by a third model after the first two disagreed. That is how corroborated grading works here; it does not mean the run was graded inconsistently.";

export function buildReport(input: ReportInput): BuiltReport {
  const findings = input.cases
    .filter((c) => c.status !== "pass")
    .sort((a, b) => severityRank(b.severity) - severityRank(a.severity) || a.caseId.localeCompare(b.caseId))
    .map((c) => ({
      case: c.caseId,
      obligation: c.obligation,
      severity: c.severity,
      expected: c.expected,
      // The judge's rationale, not the agent's words: a client report states what was
      // wrong without reproducing the conversation.
      observed: c.status === "error" ? (c.error ?? "The case did not produce a result.") : (c.rationale ?? "No rationale recorded."),
      outcome: c.status,
    }));

  const gradedBy = [
    ...new Set(input.cases.map((c) => c.judgeModel).filter((m): m is string => Boolean(m))),
  ].sort();

  // How firm each verdict is, counted rather than asserted. A single judge was
  // measured drifting on identical responses, so every verdict now goes to two
  // models and a reader is told which ones actually agreed.
  const agreementCount = (kind: string) =>
    input.cases.filter((c) => c.judgeAgreement === kind).length;

  // Independence, derived from votes already stored on every case since migration
  // 0008 — no new column and no new evidence, just a fact we were not reading.
  //
  // It is read because the sentence this block used to carry — "two independent
  // models" — was not something the system guaranteed. Until 2026-09-22 the route
  // could serve both votes from one vendor's own model family, and the report said
  // "independent" anyway. A client-facing claim has to be one the run can support.
  const votesOf = (c: (typeof input.cases)[number]) =>
    (c.judgeVotes as Array<{ model?: unknown; status?: unknown }> | undefined)
      ?.filter((v): v is { model: string; status: "pass" | "fail" | "error" } =>
        typeof v?.model === "string" && typeof v?.status === "string") ?? [];
  const corroborated = input.cases.filter(
    (c) => c.judgeAgreement === "agreed" || c.judgeAgreement === "majority",
  );
  const independent = corroborated.filter((c) => independenceOf(votesOf(c)) === "independent").length;
  const singleVendor = corroborated.length - independent;

  // A case decided by a model other than the run's usual grader is expected when a
  // third model broke a tie. Anything else means the route fell through — a provider
  // was unavailable — and only that deserves the outage note.
  const primaryGrader = (() => {
    const tally = new Map<string, number>();
    for (const c of input.cases) if (c.judgeModel) tally.set(c.judgeModel, (tally.get(c.judgeModel) ?? 0) + 1);
    return [...tally].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  })();
  const mixedGradingIsAFault = input.cases.some(
    (c) => c.judgeModel && c.judgeModel !== primaryGrader && c.judgeAgreement !== "majority",
  );

  // Only claimed when the suite actually contained one, because the sentence is in a
  // client-facing document and has to be true of this run, not of the product.
  const hadCritical = input.cases.some((c) => c.severity?.toLowerCase() === "critical");
  const criticalNote = hadCritical
    ? " Scenarios marked critical were put to a third model even where the first two agreed."
    : "";

  const corroboration = {
    method:
      (singleVendor === 0
        ? "Each verdict was put to two models from different vendors; a third settled any disagreement."
        : "Each verdict was put to two models, a different vendor's wherever one could be reached; "
          + "a third settled any disagreement. Where no second vendor was available, a second model "
          + "from the same vendor was used instead, and those verdicts are counted separately below.")
      + criticalNote,
    agreed: agreementCount("agreed"),
    majority: agreementCount("majority"),
    uncorroborated: agreementCount("unconfirmed"),
    unresolved: agreementCount("unresolved"),
    independent,
    single_vendor: singleVendor,
  };

  let comparison: Comparison | null = null;
  if (input.baseline) {
    comparison = compareRuns(
      input.baseline.cases,
      input.cases.map((c) => ({ caseId: c.caseId, status: c.status })),
    );
  }

  // A letter is withheld entirely when the run did not fully execute — see grade.ts.
  const grade = gradeRun({ coverage: input.coverage, threshold: input.passThreshold });

  const payload = {
    // 2 adds the grade, the pass mark, category coverage and duration; 3 splits a
    // disputed verdict from a dead endpoint and adds the assurance gap; 4 says how
    // many verdicts were corroborated across vendors rather than within one; 5 counts
    // the scenarios whose claimed action nothing evidenced; 5 also introduced the
    // WITHHELD band and the three coverage numbers at 6. Reports
    // sealed as any earlier format are still rendered from their own payload and must
    // keep verifying — every reader of this payload branches on absence.
    novera: { format: 6 },
    subject: {
      client: input.client,
      agent: input.agentName,
      policy_version: input.policyVersion,
      environment: input.environment,
      authorisation: input.attestation ?? "Not recorded.",
    },
    run: {
      id: input.runId,
      date: input.runDate,
      suite: `${input.suite.name} (${input.suite.key} v${input.suite.version})`,
      // Derived from the cases, not from what was intended. A fallback mid-run means
      // the evidence was not graded uniformly, and a reader has to be told.
      graded_by: gradedBy,
      graded_uniformly: gradedBy.length <= 1,
      corroboration,
      pass_threshold: input.passThreshold,
      duration_ms: input.durationMs,
      grading_funded_by: input.judge.source === "trial_free" ? "Novera trial allowance" : "customer-supplied model key",
    },
    grade: {
      band: grade.band,
      score: grade.score,
      threshold: grade.threshold,
      basis: grade.basis,
      meets_threshold: meetsThreshold(grade),
    },
    categories: input.byCategory.map((c) => ({
      category: c.category,
      planned: c.planned,
      graded: c.graded,
      passed: c.passed,
      failed: c.failed,
      errored: c.errored,
      not_run: c.notRun,
      score: c.score,
      critical_failure: c.criticalFailure,
    })),
    coverage: {
      planned: input.coverage.planned,
      graded: input.coverage.graded,
      passed: input.coverage.passed,
      failed: input.coverage.failed,
      errored: input.coverage.errored,
      // Format 3. A deadlocked verdict and a dead endpoint both produce no result, but
      // they say different things about the agent, and a client can act on only one of
      // them. The assurance gap is how much of the evaluation is missing, which is the
      // number a reader needs beside an INCOMPLETE grade.
      disputed: input.coverage.disputed,
      unverifiable: input.coverage.unverifiable,
      execution_coverage: input.coverage.executionCoverage,
      resolution_coverage: input.coverage.resolutionCoverage,
      evidence_coverage: input.coverage.evidenceCoverage,
      assurance_gap: input.coverage.assuranceGap,
      not_run: input.coverage.notRun,
      score: input.coverage.score,
      basis: input.coverage.basis,
    },
    obligations: input.byObligation.map((o) => ({
      code: o.obligation,
      covered: o.covered,
      planned: o.planned,
      graded: o.graded,
      passed: o.passed,
      failed: o.failed,
      errored: o.errored,
      not_run: o.notRun,
    })),
    findings,
    comparison: comparison
      ? {
          baseline_run: input.baseline!.runId,
          baseline_policy_version: input.baseline!.policyVersion,
          fixed: comparison.fixed,
          persistent_failures: comparison.persistentFailures,
          new_failures: comparison.newFailures,
          now_errored: comparison.nowErrored,
          error_resolved: comparison.errorResolved,
          partial: !comparison.comparable,
          note: comparison.comparable
            ? "Both runs covered the same cases."
            : `The suite changed between runs. Added: ${comparison.notInBaseline.join(", ") || "none"}. Removed: ${comparison.missingFromCurrent.join(", ") || "none"}.`,
        }
      : null,
    limitations: [
      LIMITATIONS,
      ...(gradedBy.length > 1 ? [mixedGradingIsAFault ? MIXED_GRADING_NOTE : CONSENSUS_GRADING_NOTE] : []),
      ...(corroboration.uncorroborated > 0 ? [UNCORROBORATED_NOTE] : []),
      ...(input.coverage.unverifiable > 0 ? [UNVERIFIABLE_NOTE] : []),
    ].join(" "),
  } satisfies Json;

  assertPublishable(payload, input.privateMaterial ?? []);

  return { payload, contentHash: contentHash(payload) };
}

function severityRank(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity.toLowerCase()] ?? 0;
}
