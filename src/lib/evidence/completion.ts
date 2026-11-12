/**
 * Completion runs (0083): the pure rules. A completion run re-executes, through the one run path,
 * only the scenarios of a sealed run that produced no result, and its report combines them with
 * the stored rows of the run it completes. Nothing about the original changes.
 *
 * The evidence chain: a completion may itself be completed, at most `MAX_COMPLETIONS` deep. For
 * each scenario the newest run in the chain that declared it speaks for it; an older run speaks for
 * everything no newer run re-executed. That is the whole merge, and the report states it.
 */

export const MAX_COMPLETIONS = 3;

export interface ChainLink {
  runId: string;
  /** The scenarios this run declared; null for the original run, which declared the whole suite. */
  declared: string[] | null;
}

/** What a manifest says it completes, or null for an ordinary run. */
export function completionOf(manifest: unknown): { run_id: string; report_hash: string; scenario_ids: string[] } | null {
  const c = (manifest as { completes?: unknown } | null)?.completes as { run_id?: unknown; report_hash?: unknown; scenario_ids?: unknown } | undefined;
  if (!c || typeof c.run_id !== "string" || typeof c.report_hash !== "string" || !Array.isArray(c.scenario_ids)) return null;
  return { run_id: c.run_id, report_hash: c.report_hash, scenario_ids: c.scenario_ids.map(String) };
}

/**
 * Which run's stored row speaks for each scenario: the newest link that declared it, else the
 * original. `chain` is ordered newest first and ends with the original (declared null).
 */
export function ownerOfEachScenario(chain: readonly ChainLink[], scenarioIds: readonly string[]): Map<string, string> {
  const owner = new Map<string, string>();
  for (const id of scenarioIds) {
    const link = chain.find((l) => l.declared === null || l.declared.includes(id));
    if (link) owner.set(id, link.runId);
  }
  return owner;
}

/** Keeps, of rows from every run in the chain, exactly the one that speaks for each scenario. */
export function mergeChainRows<R extends { run_id: string; case_id: string }>(chain: readonly ChainLink[], rows: readonly R[]): R[] {
  const ids = [...new Set(rows.map((r) => r.case_id))];
  const owner = ownerOfEachScenario(chain, ids);
  return rows.filter((r) => owner.get(r.case_id) === r.run_id);
}

export interface Eligibility {
  ok: string[];
  refused: Array<{ id: string; why: string }>;
}

/**
 * Which requested scenarios a completion may re-execute: each must be in the run's declaration,
 * have no result in the evidence as it stands, and be one a retest cannot harm — the diagnosis's
 * own rule (`repairFor(...).retry === "safe"`) — or one a person has retested since, with a
 * stored retest that reached a verdict (`fixedSince`): for a cause that needed a fix, that shows
 * the fix was made; for a scenario that may already have acted, it shows a person, told to check
 * their system first, chose to send it again. Novera never sends such a scenario again by itself,
 * and the panel offers exactly what this admits (`completable` in resolve.ts), so a button is
 * never shown that this then refuses. Returned in suite order.
 */
export function eligibleScenarios(args: {
  requested: readonly string[];
  suiteOrder: readonly string[];
  merged: ReadonlyMap<string, { status: string; retry: "safe" | "check_first" | "fix_first" | null; fixedSince?: boolean }>;
}): Eligibility {
  const wanted = new Set(args.requested);
  const out: Eligibility = { ok: [], refused: [] };
  for (const id of wanted) {
    if (!args.suiteOrder.includes(id)) { out.refused.push({ id, why: "is not a scenario of this run's suite" }); continue; }
    const row = args.merged.get(id);
    if (!row) { out.refused.push({ id, why: "has no stored row in this run" }); continue; }
    if (row.status !== "error") { out.refused.push({ id, why: "already has a verdict" }); continue; }
    // A retest recorded since that reached a verdict: the cause was fixed, or — for a scenario
    // that may already have acted — a person has already sent it again after the warning.
    if ((row.retry === "fix_first" || row.retry === "check_first") && row.fixedSince) continue;
    if (row.retry !== "safe") {
      out.refused.push({ id, why: row.retry === "fix_first"
        ? "would give the same answer until its cause is fixed"
        : "may already have acted in the agent's system: check there, retest it yourself, and complete the evidence once that retest reaches a verdict" });
      continue;
    }
  }
  out.ok = args.suiteOrder.filter((id) => wanted.has(id) && !out.refused.some((r) => r.id === id));
  return out;
}

/** The fixed sentences a completion report carries. Built from stored values only. */
export function completionNote(args: {
  of: string;
  ofDate: string;
  scenarioIds: readonly string[];
  completedOn: string;
  runId: string;
  carriedFrom: readonly string[];
}): string {
  const n = args.scenarioIds.length;
  const list = args.scenarioIds.join(", ");
  return `This report completes the report sealed on ${args.ofDate} with digest ${args.of}. ${n === 1 ? "Scenario" : "Scenarios"} ${list} produced no result there and ${n === 1 ? "was" : "were"} re-executed on ${args.completedOn} in run ${args.runId}, against the same agent connection, policy version, suite and language. Every other verdict is carried unchanged from the stored evidence of run ${args.carriedFrom.join(" and run ")}. The counts, grade and coverage in this report are computed from those stored rows together.`;
}

export const COMPLETION_LIMITATION =
  "Some scenarios in this report were executed on a later date than the others, after producing no result the first time; the report names them and the date. Behaviour that changed between the two dates is not visible here.";
