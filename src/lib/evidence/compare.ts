import type { CaseStatus } from "./coverage.ts";

/**
 * Baseline comparison. Nate's rule, kept literally: a rerun has to show what got
 * fixed, what stayed broken, AND what the change broke. Reporting only the first two
 * is how a policy edit quietly makes an agent worse.
 */
export interface ComparableCase {
  caseId: string;
  status: CaseStatus;
}

export interface Comparison {
  fixed: string[];
  persistentFailures: string[];
  newFailures: string[];
  nowErrored: string[];
  errorResolved: string[];
  /** Present in the current run but absent from the baseline — the suite changed. */
  notInBaseline: string[];
  /** In the baseline but missing from the current run — coverage was lost. */
  missingFromCurrent: string[];
  comparable: boolean;
}

export function compareRuns(baseline: ComparableCase[], current: ComparableCase[]): Comparison {
  const before = new Map(baseline.map((c) => [c.caseId, c.status]));
  const after = new Map(current.map((c) => [c.caseId, c.status]));

  const fixed: string[] = [];
  const persistentFailures: string[] = [];
  const newFailures: string[] = [];
  const nowErrored: string[] = [];
  const errorResolved: string[] = [];
  const notInBaseline: string[] = [];

  for (const [caseId, now] of after) {
    const then = before.get(caseId);
    if (then === undefined) {
      notInBaseline.push(caseId);
      continue;
    }
    if (then !== "pass" && now === "pass") fixed.push(caseId);
    if (then === "fail" && now === "fail") persistentFailures.push(caseId);
    if (then === "pass" && now === "fail") newFailures.push(caseId);
    if (then !== "error" && now === "error") nowErrored.push(caseId);
    if (then === "error" && now !== "error") errorResolved.push(caseId);
  }

  const missingFromCurrent = [...before.keys()].filter((id) => !after.has(id));

  return {
    fixed: fixed.sort(),
    persistentFailures: persistentFailures.sort(),
    newFailures: newFailures.sort(),
    nowErrored: nowErrored.sort(),
    errorResolved: errorResolved.sort(),
    notInBaseline: notInBaseline.sort(),
    missingFromCurrent: missingFromCurrent.sort(),
    // Two runs over different case sets can still be shown, but the diff is partial
    // and the report has to say so.
    comparable: notInBaseline.length === 0 && missingFromCurrent.length === 0,
  };
}

/**
 * Why one scenario's verdict moved between two runs, from what both stored.
 *
 * A moved verdict is not an agent change until the evidence says so. The reply's SHA-256
 * is stamped on every row by the database (0037, over the reply, the transcript and the
 * tool activity), so two runs can be compared without either reply still being held:
 * identical fingerprints with a different verdict are the graders moving, never the agent
 * improving or regressing. A read-back that answered before and not now is its own cause,
 * and a run with no reply for the scenario cannot say what the agent did at all.
 */
export type MoveCause = "agent_changed" | "graders_changed" | "readback_unavailable" | "no_reply" | "unknown";

export interface MovedEvidence {
  status: CaseStatus;
  replySha: string | null;
  replied: boolean;
  observation: string | null;
}

export const MOVE_SENTENCE: Record<MoveCause, string> = {
  agent_changed: "The agent's reply changed.",
  graders_changed: "The agent's reply was identical; the graders changed.",
  readback_unavailable: "The action could not be independently verified this time.",
  no_reply: "One of the two runs has no reply for it, so what the agent did cannot be compared.",
  unknown: "Whether the reply changed is not known: one of the runs predates reply fingerprints.",
};

export function causeOfMove(before: MovedEvidence, after: MovedEvidence): MoveCause {
  if (after.observation === "unavailable" && before.observation !== "unavailable") return "readback_unavailable";
  if (!before.replied || !after.replied) return "no_reply";
  if (before.replySha && after.replySha) return before.replySha === after.replySha ? "graders_changed" : "agent_changed";
  return "unknown";
}

/**
 * What else differed between the two runs, from their declared manifests. A policy edit is
 * the usual reason for a rerun and is said plainly; a different rubric, grader plan or way
 * of calling the agent changes what a moved verdict can mean, and is said beside it.
 */
export function contextChanges(
  before: { policyVersion: number | null; manifest: Record<string, unknown> | null },
  after: { policyVersion: number | null; manifest: Record<string, unknown> | null },
): string[] {
  const out: string[] = [];
  if (before.policyVersion !== null && after.policyVersion !== null && before.policyVersion !== after.policyVersion) {
    out.push(`The policy changed: v${before.policyVersion} → v${after.policyVersion}.`);
  }
  const b = before.manifest as { rubric_hash?: string; judge_plan?: Array<{ model: string; task: string }>; agent?: { config_hash?: string }; declared?: { release_id?: string } } | null;
  const a = after.manifest as typeof b;
  if (!b || !a) {
    out.push("One of the runs predates the declared manifest, so only the policy version can be compared.");
    return out;
  }
  if (b.rubric_hash && a.rubric_hash && b.rubric_hash !== a.rubric_hash) out.push("The grading instructions changed between the runs; a moved verdict may be the rubric, not the agent.");
  const plan = (m: typeof b) => (m?.judge_plan ?? []).filter((j) => j.task === "judge" || !j.task).map((j) => j.model).join(", ");
  if (plan(b) && plan(a) && plan(b) !== plan(a)) out.push(`The graders differed: ${plan(b)} → ${plan(a)}.`);
  if (b.agent?.config_hash && a.agent?.config_hash && b.agent.config_hash !== a.agent.config_hash) out.push("The way Novera calls the agent changed (endpoint, template or response path).");
  if (b.declared?.release_id !== a.declared?.release_id && (b.declared?.release_id || a.declared?.release_id)) {
    out.push(`The declared release changed: ${b.declared?.release_id ?? "none"} → ${a.declared?.release_id ?? "none"}.`);
  }
  return out;
}

// ---------------------------------------------------------------- scenario deltas
//
// The regression view. `compareRuns` above feeds sealed report payloads and keeps its shape
// for good; this is the operator's finer reading of the same two runs, scenario by scenario.
//
// Its one rule is the consensus story's: a verdict that moved while the agent's reply stayed
// byte-identical is the graders moving, so it is never counted as fixed or regressed — a single
// judge once drifted on 25% of identical replies and the comparison called that progress and
// breakage. The converse is held just as firmly: a pass that became a fail is a regression unless
// the evidence shows the reply was identical. Not knowing is never a reason to hide one.

/** What a run holds for a scenario: a verdict, no result, or no row at all (a run stopped early). */
export type VerdictState = CaseStatus | "not_run";

/** Whether the agent's reply was the same in both runs, as far as the stored evidence can say. */
export type ReplyMatch = "same" | "changed" | "unknown";

/** Why a scenario's verdict moved: `MoveCause`, plus a read-back that answered differently. */
export type DeltaCause = MoveCause | "readback_changed";

export interface ScenarioEvidence {
  status: CaseStatus;
  /** Whether the agent answered at all. A scenario the agent never answered has nothing to compare. */
  replied: boolean;
  /** `run_cases.raw_sha256`: stamped by the database over reply, transcript and tool activity, kept after expiry. */
  rawSha: string | null;
  /**
   * The same evidence fingerprinted without per-turn timing, while it is still held. A
   * conversation's stored transcript carries each turn's latency, so its `rawSha` differs between
   * two runs whose every word was identical; this one does not.
   */
  contentSha: string | null;
  /** A multi-turn scenario, from the transcript or, once emptied, from the scenario's definition. */
  conversation: boolean;
  /** The read-back's status (confirmed / contradicted / unavailable), or null when none happened. */
  observation: string | null;
}

export interface DeltaRun {
  runId: string;
  agentId: string;
  /** `owner`: the suite's workspace, or null for a built-in suite. A key is only the same key under one owner. */
  suite: { key: string; version: number; owner: string | null };
  /** Every scenario the run's suite declared, in order, each with its definition's digest (`scenarioDigest`). */
  scenarios: ReadonlyArray<{ id: string; digest: string; severity: string }>;
  /** The run's evidence by scenario id. A declared scenario with no entry did not run. */
  cases: ReadonlyMap<string, ScenarioEvidence>;
}

export type DeltaCategory =
  | "regressed" | "fixed" | "verdict_moved_same_reply" | "persistent_failure" | "unchanged_pass"
  | "no_result_now" | "result_again" | "added" | "retired" | "redefined";

export interface ScenarioDelta {
  caseId: string;
  category: DeltaCategory;
  severity: string;
  /** Null when the scenario is not in that run's suite. */
  base: VerdictState | null;
  target: VerdictState | null;
  /** Null when the two were not compared (added, retired, redefined) or a side has no row. */
  reply: ReplyMatch | null;
  /** Why it moved; null when nothing moved or nothing could be compared. */
  cause: DeltaCause | null;
}

export interface ScenarioDeltas {
  ok: true;
  /** The two runs used different versions of the suite. */
  crossVersion: boolean;
  deltas: ScenarioDelta[];
  counts: Record<DeltaCategory, number>;
  /** Regressions by the scenario's severity, critical first. */
  regressionsBySeverity: Record<string, number>;
  definitions: {
    /** Ids in both suites. */
    shared: number;
    /** Of those, defined identically — the only ones whose verdicts are compared. */
    identical: number;
    redefined: number;
    added: number;
    retired: number;
    /** Both runs declared exactly the same scenarios, defined the same way. */
    match: boolean;
  };
  /** Identically-defined scenarios that passed in the base run: the denominator of "previously passing". */
  comparedPasses: number;
}

export interface DeltaRefusal {
  ok: false;
  reason: "same_run" | "different_agent" | "different_suite";
  sentence: string;
}

export const DELTA_CATEGORIES: readonly DeltaCategory[] = [
  "regressed", "no_result_now", "verdict_moved_same_reply", "fixed", "result_again",
  "persistent_failure", "redefined", "added", "retired", "unchanged_pass",
];

export const DELTA_LABEL: Record<DeltaCategory, string> = {
  regressed: "Regressed",
  fixed: "Fixed",
  verdict_moved_same_reply: "Moved on an identical reply",
  persistent_failure: "Still failing",
  unchanged_pass: "Still passing",
  no_result_now: "No result now",
  result_again: "Has a result again",
  added: "Added",
  retired: "Retired",
  redefined: "Redefined",
};

/** The filter tabs, as addresses (`?view=`), each the categories it shows. */
export const DELTA_VIEWS = [
  { key: "all", label: "All", categories: DELTA_CATEGORIES },
  { key: "regressed", label: "Regressed", categories: ["regressed"] },
  { key: "fixed", label: "Fixed", categories: ["fixed"] },
  { key: "persistent", label: "Still failing", categories: ["persistent_failure"] },
  { key: "unchanged", label: "Still passing", categories: ["unchanged_pass"] },
  { key: "no-result", label: "No result", categories: ["no_result_now", "result_again"] },
  { key: "moved-same-reply", label: "Moved on identical reply", categories: ["verdict_moved_same_reply"] },
  { key: "definition", label: "Definition changed", categories: ["added", "retired", "redefined"] },
] as const satisfies ReadonlyArray<{ key: string; label: string; categories: readonly DeltaCategory[] }>;

export type DeltaView = (typeof DELTA_VIEWS)[number]["key"];

export const DELTA_CAUSE_SENTENCE: Record<DeltaCause, string> = {
  ...MOVE_SENTENCE,
  readback_changed: "The agent's reply was identical; what your own system showed when read back changed.",
};

/** The cause in a few words, for a row's summary line. */
export const DELTA_CAUSE_SHORT: Record<DeltaCause, string> = {
  agent_changed: "reply changed",
  graders_changed: "identical reply — graders moved",
  readback_changed: "identical reply — read-back changed",
  readback_unavailable: "read-back unavailable this time",
  no_reply: "no reply in one run",
  unknown: "not known whether the reply changed",
};

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];
const severityRank = (s: string) => {
  const i = SEVERITY_ORDER.indexOf(s.toLowerCase());
  return i === -1 ? SEVERITY_ORDER.length : i;
};
const byId = (a: string, b: string) => a.localeCompare(b, "en", { numeric: true });

/**
 * Whether the reply was the same, from fingerprints only (the reply itself may have been
 * emptied under the retention period). "same" is claimed only on equal fingerprints of two
 * replies that exist; anything the evidence cannot settle is "unknown", never "same".
 */
export function replyMatch(a: ScenarioEvidence, b: ScenarioEvidence): ReplyMatch {
  if (!a.replied || !b.replied) return "unknown";
  if (a.contentSha && b.contentSha) return a.contentSha === b.contentSha ? "same" : "changed";
  if (a.rawSha && b.rawSha) {
    if (a.rawSha === b.rawSha) return "same";
    // A conversation's stored fingerprint covers each turn's timing as well as its words, so a
    // different fingerprint does not show different words once either side has been emptied.
    return a.conversation || b.conversation ? "unknown" : "changed";
  }
  return "unknown";
}

/** `causeOfMove`'s order, read through `replyMatch`, and naming a read-back that answered differently. */
export function deltaCause(base: ScenarioEvidence, target: ScenarioEvidence, reply: ReplyMatch = replyMatch(base, target)): DeltaCause {
  if (target.observation === "unavailable" && base.observation !== "unavailable") return "readback_unavailable";
  if (!base.replied || !target.replied) return "no_reply";
  if (reply === "same") return (base.observation ?? null) !== (target.observation ?? null) ? "readback_changed" : "graders_changed";
  if (reply === "changed") return "agent_changed";
  return "unknown";
}

/**
 * Why two runs cannot be compared scenario by scenario, or null when they can: the same agent,
 * and the same suite key under the same owner, at this version or another.
 */
export function comparisonRefusal(base: Pick<DeltaRun, "runId" | "agentId" | "suite">, target: Pick<DeltaRun, "runId" | "agentId" | "suite">): DeltaRefusal | null {
  if (base.runId === target.runId) {
    return { ok: false, reason: "same_run", sentence: "Both sides name the same run. Choose an earlier run of this agent to compare it with." };
  }
  if (base.agentId !== target.agentId) {
    return {
      ok: false, reason: "different_agent",
      sentence: "These runs tested different agents. A comparison shows how one agent's results moved between two runs; another agent's results are not a regression of this one.",
    };
  }
  if (base.suite.key !== target.suite.key || base.suite.owner !== target.suite.owner) {
    return {
      ok: false, reason: "different_suite",
      sentence: `These runs used different suites (${base.suite.key} and ${target.suite.key}). Scenarios are compared only between runs of one suite, at the same version or another, so that a scenario is only ever compared with itself.`,
    };
  }
  return null;
}

/**
 * Every scenario of either run, classified. A scenario is compared only when both suites define
 * it identically (same digest); the same id with another definition is a different test under
 * the same name, and lands in `redefined` with both verdicts shown but neither counted.
 */
export function scenarioDeltas(base: DeltaRun, target: DeltaRun): ScenarioDeltas | DeltaRefusal {
  const refusal = comparisonRefusal(base, target);
  if (refusal) return refusal;

  const before = new Map(base.scenarios.map((s) => [s.id, s]));
  const after = new Map(target.scenarios.map((s) => [s.id, s]));
  const stateOf = (run: DeltaRun, id: string): VerdictState => run.cases.get(id)?.status ?? "not_run";
  const deltas: ScenarioDelta[] = [];

  for (const s of target.scenarios) {
    const then = before.get(s.id);
    if (!then) {
      deltas.push({ caseId: s.id, category: "added", severity: s.severity, base: null, target: stateOf(target, s.id), reply: null, cause: null });
      continue;
    }
    const b = stateOf(base, s.id);
    const t = stateOf(target, s.id);
    if (then.digest !== s.digest) {
      deltas.push({ caseId: s.id, category: "redefined", severity: s.severity, base: b, target: t, reply: null, cause: null });
      continue;
    }
    const be = base.cases.get(s.id);
    const te = target.cases.get(s.id);
    const reply = be && te ? replyMatch(be, te) : null;
    const cause = be && te && b !== t ? deltaCause(be, te, reply ?? "unknown") : null;
    const hadVerdict = b === "pass" || b === "fail";

    let category: DeltaCategory;
    if (b === "pass" && t === "pass") category = "unchanged_pass";
    else if (b === "fail" && t === "fail") category = "persistent_failure";
    else if (t === "error" || t === "not_run") category = "no_result_now";
    else if (!hadVerdict) {
      // An error is not a failure: a scenario with no result that now passes was never shown to
      // be broken, so it is a fix only when the agent answered before and answers differently now.
      category = t === "pass" && reply === "changed" ? "fixed" : "result_again";
    } else if (cause === "graders_changed") category = "verdict_moved_same_reply";
    else category = t === "fail" ? "regressed" : "fixed";

    deltas.push({ caseId: s.id, category, severity: s.severity, base: b, target: t, reply, cause });
  }
  for (const s of base.scenarios) {
    if (!after.has(s.id)) {
      deltas.push({ caseId: s.id, category: "retired", severity: s.severity, base: stateOf(base, s.id), target: null, reply: null, cause: null });
    }
  }

  deltas.sort((x, y) =>
    DELTA_CATEGORIES.indexOf(x.category) - DELTA_CATEGORIES.indexOf(y.category)
    || severityRank(x.severity) - severityRank(y.severity)
    || byId(x.caseId, y.caseId));

  const counts = Object.fromEntries(DELTA_CATEGORIES.map((c) => [c, 0])) as Record<DeltaCategory, number>;
  for (const d of deltas) counts[d.category] += 1;

  const regressionsBySeverity: Record<string, number> = {};
  for (const s of SEVERITY_ORDER) regressionsBySeverity[s] = 0;
  for (const d of deltas) {
    if (d.category === "regressed") regressionsBySeverity[d.severity.toLowerCase()] = (regressionsBySeverity[d.severity.toLowerCase()] ?? 0) + 1;
  }

  const shared = target.scenarios.filter((s) => before.has(s.id)).length;
  const definitions = {
    shared,
    identical: shared - counts.redefined,
    redefined: counts.redefined,
    added: counts.added,
    retired: counts.retired,
    match: counts.redefined === 0 && counts.added === 0 && counts.retired === 0,
  };
  const compared = new Set(deltas.filter((d) => !["added", "retired", "redefined"].includes(d.category)).map((d) => d.caseId));

  return {
    ok: true,
    crossVersion: base.suite.version !== target.suite.version,
    deltas,
    counts,
    regressionsBySeverity,
    definitions,
    comparedPasses: [...compared].filter((id) => stateOf(base, id) === "pass").length,
  };
}

/** The scenarios a view shows; an unknown view is every scenario. */
export function deltasInView(deltas: ScenarioDeltas, view: string | null | undefined): ScenarioDelta[] {
  const found = DELTA_VIEWS.find((v) => v.key === view) ?? DELTA_VIEWS[0];
  return deltas.deltas.filter((d) => (found.categories as readonly DeltaCategory[]).includes(d.category));
}

/** How many scenarios each view would show, so a tab can carry its count. */
export function viewCounts(deltas: ScenarioDeltas): Record<DeltaView, number> {
  return Object.fromEntries(DELTA_VIEWS.map((v) => [v.key, deltasInView(deltas, v.key).length])) as Record<DeltaView, number>;
}

/**
 * The comparison in plain words: whether anything that passed now fails, and — separately,
 * never folded into it — how many verdicts moved on an identical reply. Testing evidence only:
 * no sentence here may read as a clearance, a certificate or a statement of compliance.
 */
export function deltaSummary(d: ScenarioDeltas): { tone: "pass" | "fail" | "neutral"; headline: string; lines: string[] } {
  const n = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
  const regressed = d.counts.regressed;
  const moved = d.deltas.filter((x) => x.category === "verdict_moved_same_reply");
  const movedFromPass = moved.filter((x) => x.base === "pass").length;
  const lostResult = d.deltas.filter((x) => x.category === "no_result_now" && (x.base === "pass" || x.base === "fail")).length;

  const lines: string[] = [];
  if (moved.length) lines.push(`${n(moved.length, "verdict", "verdicts")} moved on an identical reply — graders, not the agent.`);
  if (lostResult) lines.push(`${n(lostResult, "scenario that had a verdict has", "scenarios that had a verdict have")} no result now; that is missing evidence, not a failure.`);
  if (d.counts.fixed) lines.push(`${n(d.counts.fixed, "scenario that did not pass before passes", "scenarios that did not pass before pass")} now.`);
  if (!d.definitions.match) {
    lines.push(`The suite changed between the runs: ${d.definitions.identical} of ${d.definitions.shared + d.definitions.added} scenarios are defined identically in both and compared; `
      + `${d.definitions.redefined} redefined, ${d.definitions.added} added and ${d.definitions.retired} retired are shown but not compared.`);
  }

  if (d.definitions.identical === 0) {
    return { tone: "neutral", headline: "No scenario could be compared: none is defined identically in both runs.", lines };
  }
  if (regressed > 0) {
    return { tone: "fail", headline: `${n(regressed, "previously passing scenario now fails", "previously passing scenarios now fail")}.`, lines };
  }
  return {
    tone: "pass",
    headline: movedFromPass > 0 ? "No previously passing scenario failed with a changed reply." : "No previously passing scenario failed.",
    lines: [`Of ${n(d.definitions.identical, "scenario", "scenarios")} compared, ${d.comparedPasses} passed in the base run.`, ...lines],
  };
}

/** The middle value of the latencies a run recorded; null when it recorded none. */
export function medianOf(values: ReadonlyArray<number | null | undefined>): number | null {
  const xs = values.filter((v): v is number => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
  if (!xs.length) return null;
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : Math.round((xs[mid - 1] + xs[mid]) / 2);
}

/**
 * What differed between the two runs besides the agent: `contextChanges`, plus the suite version
 * and whether its scenarios are the same, and each run's median agent latency.
 */
export function configurationDiff(args: {
  base: { policyVersion: number | null; manifest: Record<string, unknown> | null; suiteVersion: number; medianLatencyMs: number | null };
  target: { policyVersion: number | null; manifest: Record<string, unknown> | null; suiteVersion: number; medianLatencyMs: number | null };
  definitions: ScenarioDeltas["definitions"];
}): { changes: string[]; suiteVersions: [number, number]; definitionsMatch: boolean; medianLatencyMs: [number | null, number | null] } {
  const { base, target, definitions } = args;
  const changes: string[] = [];
  if (base.suiteVersion !== target.suiteVersion) {
    changes.push(`The suite version changed: v${base.suiteVersion} → v${target.suiteVersion}${definitions.match ? ", with every scenario defined the same way" : ""}.`);
  }
  changes.push(...contextChanges(base, target));
  return {
    changes,
    suiteVersions: [base.suiteVersion, target.suiteVersion],
    definitionsMatch: definitions.match,
    medianLatencyMs: [base.medianLatencyMs, target.medianLatencyMs],
  };
}
