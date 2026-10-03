import packFile from "../../../data/packs/packs.json" with { type: "json" };
import v5 from "../../../data/suites/eu-support-v5.json" with { type: "json" };
import v5Labels from "../../../data/suites/eu-support-v5.labels.json" with { type: "json" };
import type { SuiteCase } from "../runner/types.ts";

/**
 * Curated baseline packs: selections of eu-support v5, byte-identical.
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
const SOURCE_CASES = new Map((v5 as { cases: SuiteCase[] }).cases.map((c) => [c.id, c]));
const LABELS = (v5Labels as { labels: Record<string, { expected: "pass" | "fail" | null; why: string }> }).labels;

/** Where each v5 scenario's calibration is recorded in docs/DECISIONS.md. */
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

export function packByKey(key: string, version?: number): Pack | null {
  return PACKS.find((p) => p.key === key && (version === undefined || p.version === version)) ?? null;
}

/** The pack's scenarios, exactly as the source suite holds them. */
export function packCases(pack: Pack, quick = false): SuiteCase[] {
  const ids = quick ? pack.quick : pack.cases;
  return ids.map((id) => {
    const c = SOURCE_CASES.get(id);
    if (!c) throw new Error(`Pack ${pack.key} names ${id}, which eu-support v${pack.source.version} does not contain.`);
    return c;
  });
}

export function qualityRecord(pack: Pack, quick = false): PackQuality {
  const ids = quick ? pack.quick : pack.cases;
  const cases = packCases(pack, quick);
  const labels = ids.map((id) => LABELS[id]);
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

export function labelOf(id: string): { expected: "pass" | "fail" | null; why: string } | null {
  return LABELS[id] ?? null;
}
