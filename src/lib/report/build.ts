import { contentHash, type Json } from "./hash.ts";
import { assertPublishable } from "./redact.ts";
import { compareRuns, type Comparison } from "../evidence/compare.ts";
import { unstableInComparison, type CaseStability } from "../evidence/stability.ts";
import type { Coverage, ObligationCoverage, CategoryCoverage } from "../evidence/coverage.ts";
import { gradeRun, meetsThreshold } from "../evidence/grade.ts";
import { independenceOf } from "../judge/independence.ts";
import type { RunCaseRecord } from "../runner/types.ts";
import { redact } from "../redact/pii.ts";
import type { ReportPayload } from "./payload.ts";

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
  /**
   * Scenarios whose verdict has moved before under one policy version, from stored
   * runs up to this one. Omitted when nobody looked, which is different from empty.
   */
  stability?: Map<string, CaseStability>;
  /** Verbatim strings that must not appear in the output (policy body, system prompt). */
  privateMaterial?: string[];
  /** Declared before the run and frozen on the row; null for runs that predate it. */
  manifestHash?: string | null;
  /** What was tested and where each item came from (format 12); absent on older runs. */
  fingerprint?: NonNullable<ReportPayload["run"]["fingerprint"]> | null;
  /** The previous report for this agent, so a series chains; null for the first. */
  previousReportHash?: string | null;
}

export interface BuiltReport {
  payload: Json;
  contentHash: string;
}

/**
 * The block every report carries.
 *
 * The processing sentence was added on 2026-09-24. A reader deciding whether this
 * document supports a GDPR position needs to know that producing it sent the agent's
 * answers to third-party model providers — and reports are read by exactly that reader.
 * It is stated here rather than only in our documentation because a report is handed on
 * and read apart from the site.
 *
 * Adding to this string needs no absence branch: `limitations` has been a required
 * field of the payload since format 1, and reports already sealed keep the text that
 * was true when they were sealed.
 */
const LIMITATIONS =
  "This report records how the named agent behaved on the listed scenarios, under the recorded configuration, on the date shown. It does not cover untested interactions, does not predict future behaviour, and is not a certification or a statement of legal compliance. Obligation codes group the evidence; they do not determine which obligations apply to your organisation. Producing this evidence sent the agent's responses to the grading models named against each scenario, which are operated by third parties and may process data outside the EU.";

const UNCORROBORATED_NOTE =
  "Some verdicts in this run were produced by a single model because a second was unavailable. They are counted in the score and marked as uncorroborated below, and a release gate reads a pass that rests on one model as incomplete evidence, not a pass. Rerun the suite for a fully corroborated result.";

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

const SIMULATED_NOTE =
  "Some scenarios were conversations in which, after a message written by a person, a language model played the customer. Those conversations are test data: no real customer took part, and a model-played customer can phrase things differently from one run to the next.";

const REDACTED_GRADING_NOTE =
  "Some agent replies contained text shaped like personal data, such as an email address or a phone number. Where such a reply was graded by a model not approved to receive personal data, that text was replaced with placeholders before the model read it; the checks Novera runs itself read the reply unchanged.";

const SCRUBBED_FINDINGS_NOTE =
  "Where the description of a finding quoted something shaped like personal data, such as an email address or a phone number, this report shows a placeholder in its place. The run itself keeps the agent's reply as it was, for the people in your workspace.";

const CONTRADICTED_NOTE =
  "In one or more scenarios the agent described an action it had taken, and an independent read of your own system did not show that action. Those scenarios are recorded as failures on that basis rather than on the wording of the reply.";

const CONSENSUS_GRADING_NOTE =
  "More than one model is named as grader because some verdicts were settled by a third model after the first two disagreed. That is how corroborated grading works here; it does not mean the run was graded inconsistently.";

export function buildReport(input: ReportInput): BuiltReport {
  // A rationale is a model's prose about the reply, and a model that read the reply as
  // written can quote what it leaked. A report is a document that gets forwarded, so
  // anything shaped like personal data in it is replaced, as in a production failure.
  let redactedFindings = 0;
  const scrub = (text: string) => {
    const r = redact(text);
    if (Object.keys(r.counts).length) redactedFindings += 1;
    return r.text;
  };

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
      observed: scrub(c.status === "error" ? (c.error ?? "The case did not produce a result.") : (c.rationale ?? "No rationale recorded.")),
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

  // Named only when it happened, because it changes what "corroboration" covers in
  // the sentence below: a rule-settled verdict was never put to a model at all.
  const ruleNote = input.coverage.settledByCheck > 0
    ? ` ${input.coverage.settledByCheck} scenario(s) were settled by a rule in the scenario itself — a statement that is true or false about the transcript — and no model was asked.`
    : "";

  const corroboration = {
    method:
      (singleVendor === 0
        ? "Each verdict was put to two models from different vendors; a third settled any disagreement."
        : "Each verdict was put to two models, a different vendor's wherever one could be reached; "
          + "a third settled any disagreement. Where no second vendor was available, a second model "
          + "from the same vendor was used instead, and those verdicts are counted separately below.")
      + criticalNote + ruleNote,
    agreed: agreementCount("agreed"),
    majority: agreementCount("majority"),
    uncorroborated: agreementCount("unconfirmed"),
    // Format 13 (decision G5): the passes among them. A failure one model found is still a
    // finding; a pass nobody corroborated is not one a release can rest on.
    uncorroborated_passes: input.cases.filter((c) => c.judgeAgreement === "unconfirmed" && c.status === "pass").length,
    unresolved: agreementCount("unresolved"),
    independent,
    single_vendor: singleVendor,
    settled_by_rule: input.coverage.settledByCheck,
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
    // WITHHELD band and the three coverage numbers at 6; 7 carries the pre-execution
    // manifest digest and chains each report to the previous one for the agent; 8
    // counts the verdicts a rule settled without a model; 9 says how many claimed
    // actions were confirmed or contradicted by the customer's own system; 10 names the
    // scenarios in a comparison whose verdict had already moved under one policy
    // version, so a coin flip is not reported as a regression without saying so; 11 is
    // a reissue carrying human review; 12 states what was tested, each item recorded by
    // Novera or declared by the customer. Reports
    // sealed as any earlier format are still rendered from their own payload and must
    // keep verifying — every reader of this payload branches on absence.
    novera: { format: 13 },
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
      manifest_hash: input.manifestHash ?? null,
      previous_report_hash: input.previousReportHash ?? null,
      ...(input.fingerprint ? { fingerprint: input.fingerprint } : {}),
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
      effect_confirmed: input.coverage.effectConfirmed,
      effect_contradicted: input.coverage.effectContradicted,
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
          ...(input.stability
            ? {
                unstable: unstableInComparison(comparison, input.stability).map((id) => {
                  const s = input.stability!.get(id)!;
                  return { case_id: id, passes: s.passes, fails: s.fails, runs: s.runs };
                }),
              }
            : {}),
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
      ...(input.cases.some((c) => c.transcript?.some((t) => t.simulated)) ? [SIMULATED_NOTE] : []),
      // From the stored attempts: stated only when a grading model actually read a
      // redacted reply, not whenever redaction was possible.
      ...(input.cases.some((c) =>
        (c.judgeVotes as Array<{ redacted?: boolean }> | undefined)?.some((v) => v?.redacted)
        || (c.judgeAttempts as Array<{ ok?: boolean; redacted?: boolean }> | undefined)?.some((a) => a?.ok && a.redacted),
      ) ? [REDACTED_GRADING_NOTE] : []),
      ...(input.coverage.effectContradicted > 0 ? [CONTRADICTED_NOTE] : []),
      ...(redactedFindings > 0 ? [SCRUBBED_FINDINGS_NOTE] : []),
    ].join(" "),
  } satisfies Json;

  assertPublishable(payload, input.privateMaterial ?? []);

  return { payload, contentHash: contentHash(payload) };
}

function severityRank(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity.toLowerCase()] ?? 0;
}
