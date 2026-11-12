import type { SuiteCase } from "../runner/types.ts";

/**
 * What a suite is, counted from its scenarios: the figures a person needs before pressing Run.
 * Pure; every number is a count over the suite row, and the duration is labelled an estimate.
 */
export interface SuiteSpec {
  scenarios: number;
  bySeverity: Array<{ severity: string; count: number }>;
  byCategory: Array<{ category: string; count: number }>;
  /** References the scenarios' evidence is filed under, most used first. Organising labels, not legal conclusions. */
  references: Array<{ ref: string; count: number }>;
  /** Scenarios that carry content the customer did not type. */
  withMetadata: string[];
  /** Scenarios that are conversations (earlier turns or a simulated customer). */
  conversations: string[];
  /** Scenarios settled or guarded by a rule as well as the graders. */
  withRules: number;
  /** Scenarios that expect an action and so need evidence beyond the reply. */
  withEffect: number;
  /** Not run against an agent that serves real customers. */
  testTargetOnly: number;
  estimatedMinutes: number;
}

/**
 * Seconds per scenario on Novera's keys, from a measured run: 49 scenarios of eu-support v7 took
 * about 230 s paced (2026-11-08). An agent that answers slowly takes longer; a conversation
 * counts once per turn.
 */
export const MEASURED_SECONDS_PER_TURN = 4.7;

const SEVERITY_ORDER = ["critical", "high", "medium", "low"];

function counted<T extends string>(values: T[]): Array<{ key: T; count: number }> {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  return [...counts.entries()].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}

export function suiteSpec(cases: readonly SuiteCase[]): SuiteSpec {
  const turns = cases.reduce((n, c) => n + 1 + (c.earlier_turns?.length ?? 0) + (c.persona?.max_turns ?? 0), 0);
  return {
    scenarios: cases.length,
    bySeverity: counted(cases.map((c) => c.severity))
      .map(({ key, count }) => ({ severity: key, count }))
      .sort((a, b) => (SEVERITY_ORDER.indexOf(a.severity) + 1 || 99) - (SEVERITY_ORDER.indexOf(b.severity) + 1 || 99)),
    byCategory: counted(cases.map((c) => c.category)).map(({ key, count }) => ({ category: key, count })),
    references: counted(cases.flatMap((c) => c.duty_refs ?? [])).map(({ key, count }) => ({ ref: key, count })),
    withMetadata: cases.filter((c) => c.context && Object.keys(c.context).length > 0).map((c) => c.id),
    conversations: cases.filter((c) => (c.earlier_turns?.length ?? 0) > 0 || Boolean(c.persona)).map((c) => c.id),
    withRules: cases.filter((c) => (c.checks?.length ?? 0) > 0 || (c.turn_checks?.length ?? 0) > 0).length,
    withEffect: cases.filter((c) => Boolean(c.effect)).length,
    testTargetOnly: cases.filter((c) => c.destructive || c.fixture_only).length,
    estimatedMinutes: Math.max(1, Math.round((turns * MEASURED_SECONDS_PER_TURN) / 60)),
  };
}

/** A few scenarios to read before running: the first of each severity, most severe first, at most `limit`. */
export function sampleScenarios(cases: readonly SuiteCase[], limit = 4): SuiteCase[] {
  const out: SuiteCase[] = [];
  for (const severity of SEVERITY_ORDER) {
    for (const c of cases) {
      if (out.length >= limit) return out;
      if (c.severity === severity && !out.some((o) => o.category === c.category)) out.push(c);
    }
  }
  for (const c of cases) {
    if (out.length >= limit) break;
    if (!out.includes(c)) out.push(c);
  }
  return out;
}
