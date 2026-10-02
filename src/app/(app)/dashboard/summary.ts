import { pipelineOutcome, type PipelineOutcome } from "../../../lib/report/outcome.ts";
import type { ReportPayload } from "../../../lib/report/payload.ts";

/**
 * What one run row on the dashboard says, from its stored rows and its sealed report.
 *
 * Extracted so the rules are tested rather than buried in markup: a run in flight shows
 * no counts (a partial count read as a result is what this product exists not to do), a
 * completed run's outcome is the release gate's decision read from the sealed document,
 * and a withheld grade is named as withheld — never shown as a fail or as a percentage.
 */
export interface RunSummaryInput {
  status: string;
  payload: Pick<ReportPayload, "coverage" | "grade" | "run"> | null;
  scheduleId: string | null;
  apiKeyName: string | null;
}

export interface RunSummary {
  state: "running" | "stopped" | PipelineOutcome;
  stateLabel: string;
  tone: "live" | "neutral" | "pass" | "fail" | "error";
  band: string | null;
  counts: { passed: number; failed: number; noVerdict: number; planned: number } | null;
  coverage: { ran: number; verdict: number; planned: number } | null;
  startedBy: string;
}

const BAND_WORD: Record<string, string> = { WITHHELD: "Grade withheld", INCOMPLETE: "Incomplete" };

export function summariseRun(r: RunSummaryInput): RunSummary {
  const startedBy = r.scheduleId ? "Schedule" : r.apiKeyName ? `API · ${r.apiKeyName}` : "In the app";
  if (r.status === "queued" || r.status === "running") {
    return { state: "running", stateLabel: r.status === "queued" ? "Starting" : "Running", tone: "live", band: null, counts: null, coverage: null, startedBy };
  }
  if (r.status !== "completed") {
    return { state: "stopped", stateLabel: "Stopped, never sealed", tone: "neutral", band: null, counts: null, coverage: null, startedBy };
  }
  const outcome = pipelineOutcome({ status: r.status }, r.payload);
  const c = r.payload?.coverage;
  const band = r.payload?.grade?.band ?? null;
  const notRun = (c as { not_run?: number } | undefined)?.not_run ?? 0;
  return {
    state: outcome,
    stateLabel: outcome === "pass" ? "Pass" : outcome === "fail" ? "Fail" : "Evidence incomplete",
    tone: outcome === "pass" ? "pass" : outcome === "fail" ? "fail" : "error",
    band: band ? (BAND_WORD[band] ?? `Grade ${band}`) : null,
    counts: c ? { passed: c.passed, failed: c.failed, noVerdict: c.errored + notRun, planned: c.planned } : null,
    coverage: c ? { ran: c.planned - notRun, verdict: c.passed + c.failed, planned: c.planned } : null,
    startedBy,
  };
}
