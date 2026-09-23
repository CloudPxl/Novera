import type { CaseStatus } from "../evidence/coverage.ts";
import type { CaseEffect, EvidenceGap } from "../judge/effect.ts";
import type { DeterministicCheck } from "../judge/checks.ts";

export interface SuiteCase {
  id: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected_behavior: string;
  assertions: string[];
  forbidden?: string[];
  /**
   * Present when the expectation is an action, not just words. A pass then has to be
   * evidenced by something other than the agent saying it happened.
   */
  effect?: CaseEffect;
  /**
   * Rules that settle this scenario without a model. They can only fail it — a case
   * whose checks all hold still goes to the judges, because "did not contain the
   * forbidden phrase" is not the same as "met the expectation".
   */
  checks?: DeterministicCheck[];
}

export interface Suite {
  key: string;
  version: number;
  name: string;
  cases: SuiteCase[];
}

/**
 * Everything one scenario produced, independent of where it is filed.
 *
 * Split out of `RunCaseRecord` so that a single-case retest and a suite run are
 * graded by literally the same code. If the two paths had their own copies, a retest
 * could tell an operator their fix worked while the run that produces the client's
 * report disagreed — and the retest exists precisely to predict that run.
 */
export interface CaseOutcome {
  responseText: string | null;
  toolActivity: unknown;
  status: CaseStatus;
  rationale: string | null;
  latencyMs: number | null;
  usage: Record<string, unknown> | null;
  /** Which model actually graded this case, after any fallback. */
  judgeModel: string | null;
  /** Every judge candidate tried for this case, failures included. */
  judgeAttempts: unknown[];
  /** What each model consulted on this case said. */
  judgeVotes: unknown[];
  /** The assertions the judge found unmet. Empty for a pass. */
  failedAssertions: string[];
  /** Whether the models agreed, a third settled it, or it could not be settled. */
  judgeAgreement: string | null;
  /**
   * Set when a pass was withheld because nothing evidenced the action it claimed.
   * Null on every case that produced a verdict, and on every row stored before the
   * distinction existed.
   */
  evidenceGap: EvidenceGap | null;
  /**
   * `deterministic` when a rule decided this case and no model was asked;
   * `models` when consensus graded it. Null on rows stored before checks existed,
   * which means the models, because that is all there was.
   */
  settledBy: "deterministic" | "models" | null;
  error: string | null;
}

/** One fully-evidenced case, exactly as it is persisted against a run. */
export interface RunCaseRecord extends CaseOutcome {
  runId: string;
  caseId: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected: string;
  assertions: string[];
}

/**
 * Persistence seam. The orchestrator owns *what* counts as evidence; the store owns
 * where it lands. Keeps the run logic testable without a database, and means a
 * storage bug cannot quietly change a verdict.
 */
export interface RunStore {
  saveCase(record: RunCaseRecord): Promise<void>;
  markRunning(runId: string): Promise<void>;
  finishRun(runId: string, outcome: { status: "completed" | "aborted"; error?: string }): Promise<void>;
}
