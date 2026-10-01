import { ciOutcome, type CiInput } from "./ci.ts";

export type PipelineOutcome = "pass" | "fail" | "incomplete";

/**
 * What a finished run means to a pipeline: pass, fail or incomplete. The one place it is
 * decided for a run — the webhook says it, and the CLI's exit codes, the JUnit and JSON
 * exports derive from the same `ciOutcome` over the same sealed payload.
 *
 * Read from the sealed report, never recounted from rows. The report states what the
 * evidence supports, scenarios that never ran included; a count of stored rows does not
 * know about a scenario with no row, and once said "pass" over a report that said
 * INCOMPLETE (audit R2). No report, or a run that did not complete, is never a pass.
 */
export function pipelineOutcome(
  run: { status: string },
  payload: CiInput | null | undefined,
): PipelineOutcome {
  if (run.status !== "completed" || !payload?.coverage) return "incomplete";
  const { code } = ciOutcome(payload);
  return code === 0 ? "pass" : code === 1 ? "fail" : "incomplete";
}
