/**
 * Which runs use an allowance — the trial's three runs, a grant's units, a plan's managed runs —
 * as 0074 decides it in the database (decision 2026-10-17, docs/BILLING-DECISIONS.md).
 *
 * A run counts unless it was aborted before it recorded any scenario: stopped by a person,
 * superseded by a newer commit, ended by a slice failure or by the idle sweep before its first
 * scenario was saved. Such a run never reached the agent and produced no evidence, so it costs
 * nothing. A run still queued or running counts (it holds its place while it can still execute),
 * as does a completed one and an aborted one with at least one recorded scenario — a run halted
 * after three transport failures recorded those failures, so it counts.
 *
 * Fair use (src/lib/billing/limits.ts) is a rate limit, not an allowance, and counts every start.
 *
 * Browser-safe: the run page's scorecard reads the sentence below.
 */

/**
 * The computed column 0074 defines on `runs` with the same rule, so the application's counts
 * (`workspaceEntitlement`, `loadBillingRows`) filter in the database and never page through rows
 * to recount them: `.eq(ALLOWANCE_COLUMN, true)`.
 */
export const ALLOWANCE_COLUMN = "counts_against_allowance";

/** The SQL predicate 0074 adds to every allowance count; tests hold the migration to it. */
export const ALLOWANCE_EXCLUSION_SQL =
  "not (r.status = 'aborted' and not exists (select 1 from run_cases c where c.run_id = r.id))";

export function countsAgainstAllowance(run: { status: string; recordedScenarios: number }): boolean {
  return !(run.status === "aborted" && run.recordedScenarios === 0);
}

export const EMPTY_ABORT_IS_FREE = "This run recorded no scenario, so it does not count against your runs.";

/** The sentence to show beside an aborted run's reason, or null when the run counts. */
export function emptyAbortNote(status: string, recordedScenarios: number): string | null {
  return countsAgainstAllowance({ status, recordedScenarios }) ? null : EMPTY_ABORT_IS_FREE;
}
