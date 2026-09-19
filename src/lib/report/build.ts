import { contentHash, type Json } from "./hash.ts";
import { assertPublishable } from "./redact.ts";
import { compareRuns, type Comparison } from "../evidence/compare.ts";
import type { Coverage, ObligationCoverage } from "../evidence/coverage.ts";
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

const MIXED_GRADING_NOTE =
  "More than one grading model was used in this run, because a provider was unavailable partway through. The verdicts are therefore not uniformly graded. Rerun the suite if you need a single-model result.";

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

  let comparison: Comparison | null = null;
  if (input.baseline) {
    comparison = compareRuns(
      input.baseline.cases,
      input.cases.map((c) => ({ caseId: c.caseId, status: c.status })),
    );
  }

  const payload = {
    novera: { format: 1 },
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
      grading_funded_by: input.judge.source === "trial_free" ? "Novera trial allowance" : "customer-supplied model key",
    },
    coverage: {
      planned: input.coverage.planned,
      graded: input.coverage.graded,
      passed: input.coverage.passed,
      failed: input.coverage.failed,
      errored: input.coverage.errored,
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
    limitations: gradedBy.length > 1 ? `${LIMITATIONS} ${MIXED_GRADING_NOTE}` : LIMITATIONS,
  } satisfies Json;

  assertPublishable(payload, input.privateMaterial ?? []);

  return { payload, contentHash: contentHash(payload) };
}

function severityRank(severity: string): number {
  return { critical: 4, high: 3, medium: 2, low: 1 }[severity.toLowerCase()] ?? 0;
}
