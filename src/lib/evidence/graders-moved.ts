import type { ScenarioDelta } from "./compare.ts";

/**
 * The scenarios the run page leaves out of "newly broken" because only the graders moved.
 *
 * The page's counts come from the scenario deltas (`scenarioDeltas`): a pass that became a fail
 * on a byte-identical reply (same SHA-256 over reply, transcript and tool activity) is the
 * graders moving, so it is counted neither as broken nor as fixed. The sealed report was written
 * when the run finished with the older, status-only comparison (`compareRuns`), which would call
 * the same scenario newly broken. A sealed report is never edited, so the two can differ, and
 * this says so, in words, beside the count: from the stored deltas and the sealed payload's own
 * `comparison.new_failures`, no new comparison logic.
 */
export interface GradersMovedNote {
  /** The excluded scenarios, in the order the deltas list them. */
  ids: string[];
  sentence: string;
  /**
   * What the sealed report says about them. Null whenever it cannot be determined from stored data
   * (no report, no comparison in it, another baseline) or when the sealed report does not list any
   * of them as newly broken: nothing is said that the payload does not show.
   */
  sealedSentence: string | null;
}

const n = (count: number, one: string, many: string) => (count === 1 ? one : many);

export function gradersMovedNote(args: {
  deltas: readonly ScenarioDelta[];
  /** The baseline the page compares with (it may be one the operator picked). */
  baselineRunId: string | null;
  /** The newest sealed report's `comparison`, or null when it has none or no report exists. */
  sealedComparison: { baseline_run?: unknown; new_failures?: unknown } | null;
}): GradersMovedNote | null {
  const ids = args.deltas
    .filter((d) => d.category === "verdict_moved_same_reply" && d.base === "pass" && d.target === "fail")
    .map((d) => d.caseId);
  if (ids.length === 0) return null;

  const sentence = `${ids.length} ${n(ids.length, "scenario", "scenarios")} where the reply was unchanged and only the graders moved ${n(ids.length, "is", "are")} excluded from newly broken.`;

  const sealed = args.sealedComparison;
  let sealedSentence: string | null = null;
  if (sealed && args.baselineRunId && sealed.baseline_run === args.baselineRunId && Array.isArray(sealed.new_failures)) {
    const listed = new Set(sealed.new_failures.filter((x): x is string => typeof x === "string"));
    const counted = ids.filter((id) => listed.has(id)).length;
    if (counted === ids.length) {
      sealedSentence = `The sealed report, written when the run finished, counts ${n(ids.length, "it", "them")} as newly broken.`;
    } else if (counted > 0) {
      sealedSentence = `The sealed report, written when the run finished, counts ${counted} of them as newly broken.`;
    }
  }
  return { ids, sentence, sealedSentence };
}
