import packFile from "../../../data/packs/packs.json" with { type: "json" };
import v5 from "../../../data/suites/eu-support-v5.json" with { type: "json" };
import v5Labels from "../../../data/suites/eu-support-v5.labels.json" with { type: "json" };
import v6 from "../../../data/suites/eu-support-v6.json" with { type: "json" };
import v6Labels from "../../../data/suites/eu-support-v6.labels.json" with { type: "json" };
import type { SuiteCase } from "../runner/types.ts";

/**
 * Curated baseline packs: selections of eu-support, byte-identical — v6 for every pack offered
 * now; v5 for the version 1 of each, kept (deprecated) so a build made from it reads as made.
 *
 * A pack is where a customer starts, not what they are held to. Every scenario in it
 * becomes a draft the customer decides on, and the pack's quality record is computed
 * here from the labels and calibration that exist — never a number typed into a file,
 * because "tested" is the one word this product cannot afford to say loosely.
 */

export type PackStatus = "draft" | "published" | "deprecated";

export interface Pack {
  key: string;
  version: number;
  title: string;
  status: PackStatus;
  published?: string;
  maintainer: string;
  summary: string;
  scope: string;
  limitations: string[];
  goals: string[];
  source: { suite: string; version: number };
  cases: string[];
  quick: string[];
  /** Scenarios that assume something about the customer's own terms, with what. */
  needs_customer_policy?: Record<string, string>;
  review_notes: string;
}

export interface PackQuality {
  scenarios: number;
  /** Ground-truth labels against the scripted fixture: how many it should fail, pass. */
  expectedFail: number;
  expectedPass: number;
  /** Arguable on the fixture, so left out of measurement rather than given a label. */
  excluded: number;
  /** Scenarios with deterministic checks that can fail a case without a model. */
  ruleChecked: number;
  /** Delivered on the metadata channel or across turns: not run on an agent without the slot. */
  needsChannel: number;
  fixtures: number;
  calibration: string[];
  lastReviewed: string | null;
}

const PACKS = (packFile as { packs: Pack[] }).packs;
type Labels = Record<string, { expected: "pass" | "fail" | null; why: string }>;
const casesOf = (suite: unknown) => new Map((suite as { cases: SuiteCase[] }).cases.map((c) => [c.id, c]));
/** Each eu-support version a pack can be taken from, with its ground-truth labels. */
const SOURCES: ReadonlyMap<number, { cases: Map<string, SuiteCase>; labels: Labels }> = new Map([
  [5, { cases: casesOf(v5), labels: (v5Labels as { labels: Labels }).labels }],
  [6, { cases: casesOf(v6), labels: (v6Labels as { labels: Labels }).labels }],
]);
const NEWEST_SOURCE = Math.max(...SOURCES.keys());
const sourceOf = (pack: Pack) => {
  const source = SOURCES.get(pack.source.version);
  if (!source) throw new Error(`Pack ${pack.key} is taken from eu-support v${pack.source.version}, which no pack source holds.`);
  return source;
};

/**
 * Where each scenario's calibration is recorded in docs/DECISIONS.md. v6 changed only rules, which
 * settle a case before any grader reads it, so the graders' measurements on these inputs still hold.
 */
function calibrationOf(id: string): string {
  const n = Number(id.slice(1));
  if (n <= 36) return "T01–T36: judge route measured over eu-support v3, 2026-09-24";
  if (n <= 41) return "T37–T41: measured on the route judges, 20 of 20 matching labels, 2026-09-25";
  return "T42–T49: measured on the route judges, no false pass, 2026-09-29";
}

export function allPacks(): Pack[] {
  return PACKS;
}

/** Only published packs are offered. A draft pack has no measured scenarios behind it. */
export function publishedPacks(): Pack[] {
  return PACKS.filter((p) => p.status === "published");
}

/**
 * A pack by key: the version named, or else the newest published one (the one offered). A build
 * names the version it was made from, so an older build still finds its own.
 */
export function packByKey(key: string, version?: number): Pack | null {
  if (version !== undefined) return PACKS.find((p) => p.key === key && p.version === version) ?? null;
  const own = PACKS.filter((p) => p.key === key).sort((a, b) => b.version - a.version);
  return own.find((p) => p.status === "published") ?? own[0] ?? null;
}

/** The pack's scenarios, exactly as the source suite holds them. */
export function packCases(pack: Pack, quick = false): SuiteCase[] {
  const ids = quick ? pack.quick : pack.cases;
  return ids.map((id) => {
    const c = sourceOf(pack).cases.get(id);
    if (!c) throw new Error(`Pack ${pack.key} names ${id}, which eu-support v${pack.source.version} does not contain.`);
    return c;
  });
}

export function qualityRecord(pack: Pack, quick = false): PackQuality {
  const ids = quick ? pack.quick : pack.cases;
  const cases = packCases(pack, quick);
  const labels = ids.map((id) => sourceOf(pack).labels[id]);
  return {
    scenarios: ids.length,
    expectedFail: labels.filter((l) => l?.expected === "fail").length,
    expectedPass: labels.filter((l) => l?.expected === "pass").length,
    excluded: labels.filter((l) => !l || l.expected === null).length,
    ruleChecked: cases.filter((c) => (c.checks?.length ?? 0) > 0 || (c.turn_checks?.length ?? 0) > 0).length,
    needsChannel: cases.filter((c) => c.context || c.earlier_turns?.length || c.persona).length,
    fixtures: ids.length ? 1 : 0,
    calibration: [...new Set(ids.map(calibrationOf))].sort(),
    lastReviewed: pack.published ?? null,
  };
}

/** Roughly how long deciding on these takes: longer for what can do more harm. */
export function reviewMinutes(cases: Array<{ severity: string }>, needsAnswer = 0): number {
  const seconds = cases.reduce((s, c) => s + (c.severity === "critical" || c.severity === "high" ? 75 : 40), 0) + needsAnswer * 90;
  return Math.max(1, Math.round(seconds / 60));
}

/**
 * The pack to show first, from what the person told onboarding. A suggestion with its
 * reason, never a choice made for them.
 */
export function suggestedPack(goal: string | null | undefined): { pack: Pack; quick: boolean; reason: string } {
  const baseline = packByKey("eu-support-baseline")!;
  if (goal === "governance") {
    return { pack: packByKey("gdpr-data-subject-rights")!, quick: false, reason: "You said you are responsible for governance, and personal-data requests are where support agents are most often asked for evidence." };
  }
  if (goal === "client_delivery") {
    return { pack: baseline, quick: true, reason: "You said you deliver agents for clients: twelve high-severity scenarios make a first suite a client can read." };
  }
  return { pack: baseline, quick: true, reason: "Twelve of the baseline's highest-severity scenarios: a useful first suite in a few minutes of review." };
}

/** A scenario's ground-truth label in the eu-support version a pack was taken from (the newest by default). */
export function labelOf(id: string, sourceVersion: number = NEWEST_SOURCE): { expected: "pass" | "fail" | null; why: string } | null {
  return SOURCES.get(sourceVersion)?.labels[id] ?? null;
}
