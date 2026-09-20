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
    corroboration: {
      method: string;
      agreed: number;
      majority: number;
      uncorroborated: number;
      unresolved: number;
    };
    grading_funded_by: string;
  };
  coverage: {
    planned: number;
    graded: number;
    passed: number;
    failed: number;
    errored: number;
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
};

export function obligationLabel(code: string): string {
  return OBLIGATION_LABELS[code] ?? code.replace(/_/g, " ");
}
