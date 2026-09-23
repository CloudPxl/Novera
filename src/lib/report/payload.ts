/**
 * The shape `buildReport` produces and the report page renders.
 *
 * Declared separately from the builder because the page reads a payload that was
 * stored possibly months earlier: `novera.format` is the version marker that lets a
 * future change be handled rather than silently mis-rendered.
 */
export interface ReportPayload {
  novera: { format: number };
  subject: {
    client: string;
    agent: string;
    policy_version: number;
    environment: string;
    authorisation: string;
  };
  run: {
    id: string;
    date: string;
    suite: string;
    graded_by: string[];
    graded_uniformly: boolean;
    /** Absent on reports sealed before corroboration was recorded (format 1). */
    /** Absent on format 1. */
    pass_threshold?: number;
    /** Absent on format 1, or when timestamps were not recorded. */
    duration_ms?: number | null;
    corroboration?: {
      method: string;
      agreed: number;
      majority: number;
      uncorroborated: number;
      unresolved: number;
      /**
       * Absent before format 4. Verdicts corroborated by a second model from a
       * *different vendor* — the only kind that is independent in any meaningful
       * sense. Two models from one vendor share a lineage and a serving stack, so
       * they can agree for reasons that have nothing to do with the evidence.
       */
      independent?: number;
      /** Absent before format 4. Corroborated, but within a single vendor. */
      single_vendor?: number;
    };
    grading_funded_by: string;
  };
  /** Absent on format 1. */
  grade?: {
    /**
     * `WITHHELD` appears only from format 6. Earlier payloads used `INCOMPLETE` for
     * both reasons a letter can be missing, so an older report saying `INCOMPLETE`
     * may mean either — which is exactly why they were separated.
     */
    band: "A" | "B" | "C" | "F" | "INCOMPLETE" | "WITHHELD";
    score: number | null;
    threshold: number;
    basis: string;
    meets_threshold: boolean | null;
  };
  /** Absent on format 1. */
  categories?: Array<{
    category: string;
    planned: number;
    graded: number;
    passed: number;
    failed: number;
    errored: number;
    not_run: number;
    score: number | null;
    critical_failure: boolean;
  }>;
  coverage: {
    planned: number;
    graded: number;
    passed: number;
    failed: number;
    errored: number;
    /** Absent before format 3. The subset of `errored` the models could not settle. */
    disputed?: number;
    /**
     * Absent before format 6. Three questions a single percentage cannot answer:
     * how much of the suite ran, how much of what ran produced an accountable
     * reason, and how much of the evidence a scenario asked for was actually
     * observed. `resolution` and `evidence` are `null` where the run carries nothing
     * to compute them from — never 0, and never 100.
     */
    execution_coverage?: number;
    resolution_coverage?: number | null;
    evidence_coverage?: number | null;
    /**
     * Absent before format 5. The subset of `errored` where the agent described an
     * action and nothing evidenced that it happened, so a pass was withheld. A limit
     * of the test setup, not a fault in the agent.
     */
    unverifiable?: number;
    /** Absent before format 3. Share of the suite that produced no verdict, as a %. */
    assurance_gap?: number;
    not_run: number;
    score: number | null;
    basis: string;
  };
  obligations: Array<{
    code: string;
    covered: boolean;
    planned: number;
    graded: number;
    passed: number;
    failed: number;
    errored: number;
    not_run: number;
  }>;
  findings: Array<{
    case: string;
    obligation: string;
    severity: string;
    expected: string;
    observed: string;
    outcome: "fail" | "error";
  }>;
  comparison: {
    baseline_run: string;
    baseline_policy_version: number;
    fixed: string[];
    persistent_failures: string[];
    new_failures: string[];
    now_errored: string[];
    error_resolved: string[];
    partial: boolean;
    note: string;
  } | null;
  limitations: string;
}

/** Obligation codes rendered for a reader who has never seen our vocabulary. */
export const OBLIGATION_LABELS: Record<string, string> = {
  identity_verification: "Identity verification",
  authorization_boundary: "Authorisation boundary",
  erasure_request: "Erasure requests",
  data_access_export: "Data access and export",
  policy_accuracy: "Policy accuracy",
  source_grounding: "Grounded in documentation",
  instruction_integrity: "Instruction integrity",
  escalation_and_human_review: "Escalation and human review",
  transaction_safety: "Transaction safety",
  failure_transparency: "Failure transparency",
  // Added with eu-support v2.
  ai_disclosure: "Disclosure that the agent is automated",
  automated_decision_notice: "Notice about an automated decision",
  data_subject_access: "Subject access requests",
  rectification_and_objection: "Correction and objection requests",
};

export function obligationLabel(code: string): string {
  return OBLIGATION_LABELS[code] ?? code.replace(/_/g, " ");
}
