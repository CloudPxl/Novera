import { CI_EXIT, ciOutcome, type CiInput } from "../report/ci.ts";
import { TRANSPORT_HALT_MESSAGE } from "../runner/execute.ts";
import type { ScenarioDeltas } from "../evidence/compare.ts";

/**
 * What a run means to a CI gate, as the published exit codes (0 pass · 1 fail ·
 * 2 incomplete · 3 configuration · 4 infrastructure; `src/lib/report/ci.ts`).
 *
 * A sealed report decides with its own code, through the same `ciOutcome` the JUnit and JSON
 * exports, the CLI and the webhook use — never recounted from rows. Without one:
 *
 *   queued / running            no code yet (null): keep driving the run
 *   aborted, agent unreachable  4 — the runner halted after three transport failures in a row;
 *                               that is the endpoint's availability, not a finding about it
 *   aborted otherwise           2 — stopped, superseded, idle or ended by a failure: no evidence
 *   completed, report withdrawn 3 — someone in the workspace withdrew it; a person decides
 *   completed, nothing sealed   2 — no scenario produced a result, so nothing was sealed
 */

export interface CiRunState {
  status: string;
  error: string | null;
  /** The newest report sealed for the run, withdrawn or not; null when none was sealed. */
  report: { payload: CiInput | null; revoked: boolean; /** Its payload no longer hashes to its seal. */ mismatch?: boolean } | null;
}

export interface CiExit {
  code: 0 | 1 | 2 | 3 | 4 | null;
  reason: string;
}

export function isTransportHalt(error: string | null | undefined): boolean {
  return typeof error === "string" && error.startsWith(TRANSPORT_HALT_MESSAGE.slice(0, 60));
}

export function ciRunExit(run: CiRunState): CiExit {
  if (run.status === "queued" || run.status === "running") {
    return { code: null, reason: `The run is ${run.status}. Call execute until it is done, then read this again.` };
  }
  if (run.status === "aborted") {
    if (isTransportHalt(run.error)) {
      return { code: CI_EXIT.infrastructure, reason: "The agent could not be reached or was rate-limiting, so the run was halted and no report was sealed. This is not a finding about the agent." };
    }
    // The stored sentence is not repeated: "Stopped by" names a person's address, and a CI
    // artifact is often public. A superseding commit is named — it is the pipeline's own.
    const why = run.error?.startsWith("Superseded by ") ? run.error.split(" before it finished")[0].replace(/^Superseded/, "it was superseded")
      : run.error?.startsWith("Stopped by ") ? "a member of the workspace stopped it"
      : null;
    return { code: CI_EXIT.incomplete, reason: `The run ended before it finished${why ? ` (${why})` : ""}, so no report was sealed and there is no evidence to gate on.` };
  }
  if (run.status !== "completed") {
    return { code: CI_EXIT.incomplete, reason: `The run is ${run.status}; no report was sealed.` };
  }
  if (!run.report) {
    return { code: CI_EXIT.incomplete, reason: "The run completed without a sealed report. If it finished in the last few minutes its report may still be being sealed, so read this again shortly; otherwise no scenario produced a result to seal." };
  }
  if (run.report.revoked) {
    return { code: CI_EXIT.configuration, reason: "The report for this run was withdrawn by someone in the workspace." };
  }
  // Its stored contents no longer give the digest it was sealed with: nothing in it can be gated
  // on, exactly as /verify says "does not match" (final audit D-4, 2026-10-28).
  if (run.report.mismatch) {
    return { code: CI_EXIT.configuration, reason: "The sealed report for this run no longer matches its seal, so it cannot be read as evidence. Check it at /verify." };
  }
  if (!run.report.payload?.coverage) {
    return { code: CI_EXIT.incomplete, reason: "The sealed report carries no counts to decide on." };
  }
  return ciOutcome(run.report.payload);
}

/** Exactly the sentence a pipeline prints: whether anything that passed before fails now. */
export function baselineSentence(newlyBroken: number): string {
  if (newlyBroken === 0) return "No previously passing scenario failed";
  return newlyBroken === 1 ? "1 previously passing scenario now fails" : `${newlyBroken} previously passing scenarios now fail`;
}

export interface BaselineComparison {
  base_run_id: string;
  compare_url: string;
  /** Scenario ids that passed in the base run and fail now, on an identically-defined scenario. */
  newly_broken: string[];
  /** Scenario ids that did not pass before and pass now. */
  fixed: string[];
  /** Scenario ids whose verdict moved on an identical reply: the graders moved, not the agent. Never counted as fixed or broken. */
  graders_moved: string[];
  summary: string;
}

/**
 * The comparison the run page shows, as a pipeline reads it. Categories come from
 * `scenarioDeltas` unchanged: a verdict that moved on an identical reply is `graders_moved`,
 * never fixed or newly broken.
 */
export function baselineComparison(deltas: ScenarioDeltas, baseRunId: string, targetRunId: string, origin: string): BaselineComparison {
  const ids = (category: string) => deltas.deltas.filter((d) => d.category === category).map((d) => d.caseId);
  const newlyBroken = ids("regressed");
  return {
    base_run_id: baseRunId,
    compare_url: `${origin}/runs/compare?base=${encodeURIComponent(baseRunId)}&target=${encodeURIComponent(targetRunId)}`,
    newly_broken: newlyBroken,
    fixed: ids("fixed"),
    graders_moved: ids("verdict_moved_same_reply"),
    summary: baselineSentence(newlyBroken.length),
  };
}

/** The earlier comparable run to compare with: the newest completed one created before this run. */
export function previousComparable<T extends { id: string; createdAt: string }>(runs: readonly T[], run: { id: string; createdAt: string }): T | null {
  return runs
    .filter((r) => r.id !== run.id && r.createdAt < run.createdAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null;
}
