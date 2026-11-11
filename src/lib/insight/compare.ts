import type { CardScenario, InsightCard } from "./card.ts";

/**
 * Two graded scans of one target, scenario by scenario: what moved. Computed from the two cards,
 * which are computed from stored rows, so a "resolved" here is a stored fail followed by a stored
 * pass and nothing else. A scenario with no result on either side is never counted as resolved
 * or regressed: there is no verdict to move from or to.
 */
export type Movement =
  | "resolved"
  | "regressed"
  | "still_failing"
  | "still_passing"
  | "no_result_now"
  | "result_now"
  | "no_result_both"
  | "only_one_scan";

export const MOVEMENT_WORDS: Record<Movement, string> = {
  resolved: "Resolved: failed before, passes now",
  regressed: "Regressed: passed before, fails now",
  still_failing: "Still failing",
  still_passing: "Still passing",
  no_result_now: "No result now (a verdict before)",
  result_now: "A verdict now (no result before)",
  no_result_both: "No result in either scan",
  only_one_scan: "In one scan only",
};

export interface ComparisonRow {
  id: string;
  headline: string | null;
  before: CardScenario["verdict"] | null;
  after: CardScenario["verdict"] | null;
  movement: Movement;
}

export interface ScanComparison {
  beforeDate: string | null;
  afterDate: string | null;
  rows: ComparisonRow[];
  counts: Record<Movement, number>;
  sentence: string;
}

const verdict = (v: CardScenario["verdict"] | null) => (v === "pass" || v === "fail" ? v : null);

function movementOf(before: CardScenario | undefined, after: CardScenario | undefined): Movement {
  if (!before || !after) return "only_one_scan";
  const b = verdict(before.verdict);
  const a = verdict(after.verdict);
  if (b === null && a === null) return "no_result_both";
  if (b === null) return "result_now";
  if (a === null) return "no_result_now";
  if (b === "fail" && a === "pass") return "resolved";
  if (b === "pass" && a === "fail") return "regressed";
  return a === "pass" ? "still_passing" : "still_failing";
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function compareScans(before: InsightCard, after: InsightCard): ScanComparison {
  const ids = [...new Set([...before.scenarios.map((s) => s.id), ...after.scenarios.map((s) => s.id)])].sort();
  const rows = ids.map((id): ComparisonRow => {
    const b = before.scenarios.find((s) => s.id === id);
    const a = after.scenarios.find((s) => s.id === id);
    return { id, headline: (a ?? b)?.headline ?? null, before: b?.verdict ?? null, after: a?.verdict ?? null, movement: movementOf(b, a) };
  });
  const counts = Object.fromEntries((Object.keys(MOVEMENT_WORDS) as Movement[]).map((m) => [m, rows.filter((r) => r.movement === m).length])) as Record<Movement, number>;
  const compared = rows.length - counts.only_one_scan;
  const gaps = counts.no_result_now + counts.no_result_both + counts.result_now;
  const sentence = [
    `Of ${plural(compared, "scenario")} in both scans, ${counts.resolved} resolved and ${counts.regressed} regressed; ${counts.still_failing} still ${counts.still_failing === 1 ? "fails" : "fail"} and ${counts.still_passing} still ${counts.still_passing === 1 ? "passes" : "pass"}.`,
    gaps ? `${plural(gaps, "scenario")} had no result in one scan or both, so ${gaps === 1 ? "it shows" : "they show"} no movement either way.` : "",
  ].filter(Boolean).join(" ");
  return { beforeDate: before.scanDate, afterDate: after.scanDate, rows, counts, sentence };
}
