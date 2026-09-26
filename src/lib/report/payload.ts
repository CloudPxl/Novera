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
      /**
       * Absent before format 8. Verdicts a rule in the scenario settled, with no
       * model asked. They carry no corroboration because none was needed: the
       * statement is true or false about the transcript and identical on a rerun.
       */
      settled_by_rule?: number;
    };
    grading_funded_by: string;
    /**
     * Absent before format 7, and absent on any run started before the manifest
     * existed. The digest of what this run declared about itself *before* it ran —
     * suite version and case ids, policy version, agent, judge plan, rubric digest,
     * runner version, pass mark. The content hash proves the document was not edited;
     * this proves the inputs were not chosen after the answers were known.
     */
    manifest_hash?: string | null;
    /**
     * Absent before format 7. The content hash of the previous report published for
     * the same agent, so a series of reports forms a chain rather than a set of
     * unrelated documents. Null for the first one.
     */
    previous_report_hash?: string | null;
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
    /**
     * Absent before format 9. The only numbers here that say an action actually
     * happened rather than was described: `effect_confirmed` is a claimed action an
     * independent read of the customer's own system showed to be real, and
     * `effect_contradicted` is one it showed to be false.
     */
    effect_confirmed?: number;
    effect_contradicted?: number;
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
    /**
     * Format 10. Scenarios in `fixed` or `new_failures` whose verdict had already
     * changed between earlier runs under one policy version — so their movement here is
     * not, on its own, evidence about the change. They are never removed from those
     * lists. Absent on reports sealed as format 9 or earlier, which made no such claim;
     * an empty array means it was checked and nothing qualified.
     */
    unstable?: Array<{ case_id: string; passes: number; fails: number; runs: number }>;
  } | null;
  /**
   * Format 11, and only on a report reissued to disclose human review. What members of
   * the tested workspace found when they reviewed the verdicts above. It changes no
   * verdict, count, grade or score in this document; `with_findings_applied` is their
   * reading, stated beside the automated one and never in place of it. Absent on every
   * report sealed at the end of a run, which is every report before format 11.
   */
  human_review?: {
    reviewed_by: string;
    as_of: string;
    reviewed: number;
    agreed: number;
    disagreed: number;
    resolved_gaps: number;
    /** Disagreements and gap fills, each with the reason given. Agreements are counted only. */
    findings: Array<{
      case_id: string;
      verdict: "pass" | "fail" | "error";
      finding: "pass" | "fail";
      note: string;
      reviewed_at: string;
    }>;
    with_findings_applied: { passed: number; failed: number; no_verdict: number; changed: number };
    note: string;
  };
  /**
   * Format 11. Present when this document reissues an earlier report for the same run.
   * `of` is that report's content hash; everything above `human_review` is carried from
   * it unchanged, so the two can be compared line by line.
   */
  reissue?: { of: string; reason: string };
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

/**
 * Whether the score is shown as a band word rather than a percentage.
 *
 * When the grade is WITHHELD or INCOMPLETE the percentage over the scenarios that did
 * produce a verdict is still stored, but printed beside "Withheld" it reads as the grade
 * the report just declined to give. So every rendering — page, Markdown, CSV — shows the
 * band's word instead. Rendering only: the sealed payload and its hash are untouched,
 * and a payload with no grade (format 1) shows its score as before.
 */
export function scoreWithheldAs(payload: Pick<ReportPayload, "grade">): "withheld" | "incomplete" | null {
  const band = payload.grade?.band;
  if (band === "WITHHELD") return "withheld";
  if (band === "INCOMPLETE") return "incomplete";
  return null;
}
