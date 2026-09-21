import type { CaseStatus } from "../evidence/coverage.ts";

export interface SuiteCase {
  id: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected_behavior: string;
  assertions: string[];
  forbidden?: string[];
}

export interface Suite {
  key: string;
  version: number;
  name: string;
  cases: SuiteCase[];
}

/** One fully-evidenced case, exactly as it is persisted. */
export interface RunCaseRecord {
  runId: string;
  caseId: string;
  category: string;
  obligation: string;
  severity: string;
  input: string;
  expected: string;
  assertions: string[];
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
  error: string | null;
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
