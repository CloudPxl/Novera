import euSupportV5 from "../../../data/suites/eu-support-v5.json" with { type: "json" };
import euSupportV5Tiers from "../../../data/suites/eu-support-v5.tiers.json" with { type: "json" };
// Each sidecar is registered with its suite file, so tiers match a scenario by its definition.
// `tests/suite-registry.test.ts` fails if a *.tiers.json on disk is not listed here.
import euGdprSupportV1 from "../../../data/suites/eu-gdpr-support-v1.json" with { type: "json" };
import euGdprSupportV1Tiers from "../../../data/suites/eu-gdpr-support-v1.tiers.json" with { type: "json" };
import eCommerceRefundV1 from "../../../data/suites/e-commerce-refund-v1.json" with { type: "json" };
import eCommerceRefundV1Tiers from "../../../data/suites/e-commerce-refund-v1.tiers.json" with { type: "json" };
import fintechKycV1 from "../../../data/suites/fintech-kyc-v1.json" with { type: "json" };
import fintechKycV1Tiers from "../../../data/suites/fintech-kyc-v1.tiers.json" with { type: "json" };
// Later versions: each redefines a few scenarios and registers its own complete sidecar, matched by
// definition, so a run of either version finds its tiers.
import euSupportV6 from "../../../data/suites/eu-support-v6.json" with { type: "json" };
import euSupportV6Tiers from "../../../data/suites/eu-support-v6.tiers.json" with { type: "json" };
import euGdprSupportV2 from "../../../data/suites/eu-gdpr-support-v2.json" with { type: "json" };
import euGdprSupportV2Tiers from "../../../data/suites/eu-gdpr-support-v2.tiers.json" with { type: "json" };
import fintechKycV2 from "../../../data/suites/fintech-kyc-v2.json" with { type: "json" };
import fintechKycV2Tiers from "../../../data/suites/fintech-kyc-v2.tiers.json" with { type: "json" };
import type { SuiteCase } from "../runner/types.ts";
import { scenarioDigest } from "./digest.ts";

/**
 * Severity tiers: the kind of boundary a failure in a scenario crosses, for triage.
 *
 * A tier is a classification kept *beside* a suite, in `data/suites/<key>-v<version>.tiers.json`,
 * never inside it. It is not part of the suite digest, a run's manifest or any sealed report, so
 * a misjudged tier is corrected by editing the sidecar, without a new suite version. It says
 * which failures to look at first; it is not a legal conclusion about anyone's duties.
 *
 * Server-only in practice: it hashes scenarios with `node:crypto` and imports suite files. A
 * client component receives tier labels as props.
 */
export const TIERS = ["statutory_critical", "business_rule", "tone_guideline"] as const;
export type Tier = (typeof TIERS)[number];

export const TIER_LABELS: Record<Tier, string> = {
  statutory_critical: "Legal or safety boundary",
  business_rule: "Business rule",
  tone_guideline: "Tone and style",
};

export const TIER_DESCRIPTIONS: Record<Tier, string> = {
  statutory_critical: "A failure can cross a legal duty or put people, their data or their money at risk.",
  business_rule: "A failure departs from the operator's own terms, prices, documentation or routing.",
  tone_guideline: "A failure is about how the agent says something, not what it does or discloses.",
};

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

/** The sidecar contract: `{ suite, version, purpose, tiers: { <scenario id>: <tier> } }`. */
export interface TierSidecar {
  suite: string;
  version: number;
  purpose: string;
  tiers: Record<string, Tier>;
}

/** A classified suite version: its sidecar, and the suite file it classifies. */
interface Registration {
  tiers: unknown;
  suite: unknown;
}

/**
 * Every classified suite version. The suite file travels with its sidecar because a tier
 * belongs to a scenario *definition*, not to an id: the same id redefined in another version
 * (or in a workspace's own suite that reuses a key) is a different test, and is matched by
 * `scenarioDigest`, never by name.
 */
const REGISTERED: Registration[] = [
  { tiers: euSupportV5Tiers, suite: euSupportV5 },
  { tiers: euGdprSupportV1Tiers, suite: euGdprSupportV1 },
  { tiers: eCommerceRefundV1Tiers, suite: eCommerceRefundV1 },
  { tiers: fintechKycV1Tiers, suite: fintechKycV1 },
  { tiers: euSupportV6Tiers, suite: euSupportV6 },
  { tiers: euGdprSupportV2Tiers, suite: euGdprSupportV2 },
  { tiers: fintechKycV2Tiers, suite: fintechKycV2 },
];

export interface ClassifiedVersion {
  key: string;
  version: number;
  purpose: string;
  /** Scenario id → its definition's digest and tier, for the ids the sidecar classifies validly. */
  scenarios: Map<string, { digest: string; tier: Tier }>;
}

/**
 * Reads one registration, keeping only what is well formed and recording everything that is
 * not. A malformed entry leaves its scenario "not classified" rather than breaking every page
 * that shows a tier; the registry test holds `problems` at empty, so it never ships that way.
 */
export function parseRegistration(reg: Registration): { classified: ClassifiedVersion | null; problems: string[] } {
  const problems: string[] = [];
  const t = (reg.tiers ?? null) as Partial<TierSidecar> | null;
  const s = (reg.suite ?? null) as { key?: unknown; version?: unknown; cases?: unknown } | null;
  const where = `${String(t?.suite)} v${String(t?.version)} tiers`;
  if (!t || typeof t.suite !== "string" || typeof t.version !== "number" || !t.tiers || typeof t.tiers !== "object") {
    return { classified: null, problems: [`${where}: not a tiers sidecar ({ suite, version, purpose, tiers }).`] };
  }
  if (typeof t.purpose !== "string" || !t.purpose.trim()) problems.push(`${where}: \`purpose\` must say what the classification is for.`);
  if (!s || s.key !== t.suite || s.version !== t.version || !Array.isArray(s.cases)) {
    return { classified: null, problems: [...problems, `${where}: registered beside a suite file that is not ${t.suite} v${t.version}.`] };
  }
  const cases = s.cases as SuiteCase[];
  const ids = new Set(cases.map((c) => c.id));
  const scenarios = new Map<string, { digest: string; tier: Tier }>();
  for (const [id, tier] of Object.entries(t.tiers as Record<string, unknown>)) {
    if (!ids.has(id)) problems.push(`${where}: ${id} is not a scenario of ${t.suite} v${t.version}.`);
    else if (!isTier(tier)) problems.push(`${where}: ${id} has ${JSON.stringify(tier)}, which is not one of ${TIERS.join(", ")}.`);
  }
  for (const c of cases) {
    const tier = (t.tiers as Record<string, unknown>)[c.id];
    if (tier === undefined) problems.push(`${where}: ${c.id} is not classified.`);
    if (isTier(tier)) scenarios.set(c.id, { digest: scenarioDigest(c), tier });
  }
  return { classified: { key: t.suite, version: t.version, purpose: String(t.purpose ?? ""), scenarios }, problems };
}

function load(): { classified: ClassifiedVersion[]; problems: string[] } {
  const classified: ClassifiedVersion[] = [];
  const problems: string[] = [];
  for (const reg of REGISTERED) {
    const parsed = parseRegistration(reg);
    problems.push(...parsed.problems);
    if (!parsed.classified) continue;
    if (classified.some((c) => c.key === parsed.classified!.key && c.version === parsed.classified!.version)) {
      problems.push(`${parsed.classified.key} v${parsed.classified.version}: registered twice.`);
      continue;
    }
    classified.push(parsed.classified);
  }
  // Newest first within a key, so a lookup meets the most recent classification first.
  classified.sort((a, b) => a.key.localeCompare(b.key) || b.version - a.version);
  // One definition, one tier: two sidecars may not classify an identical scenario differently.
  const seen = new Map<string, { tier: Tier; at: string }>();
  for (const c of classified) {
    for (const [id, { digest, tier }] of c.scenarios) {
      const prior = seen.get(`${c.key}:${id}:${digest}`);
      if (prior && prior.tier !== tier) {
        problems.push(`${c.key} ${id}: the same definition is ${prior.tier} in ${prior.at} and ${tier} in v${c.version}.`);
      } else if (!prior) seen.set(`${c.key}:${id}:${digest}`, { tier, at: `v${c.version}` });
    }
  }
  return { classified, problems };
}

const REGISTRY = load();

/** The classified suite versions, newest first within each key. */
export function classifiedVersions(): readonly ClassifiedVersion[] {
  return REGISTRY.classified;
}

/** Everything wrong with a registered sidecar. Empty in a shippable tree (tests hold it there). */
export function registryProblems(): readonly string[] {
  return REGISTRY.problems;
}

/**
 * A scenario's tier, and the classified version it was read from — or null, "not classified".
 *
 * The version's own sidecar is asked first; failing that, the newest classified version of the
 * same key that holds this scenario with an identical definition. A scenario that changed
 * between versions has no tier until someone classifies the version that holds it.
 */
export function tierOf(key: string, version: number, scenario: SuiteCase): { tier: Tier; from: number } | null {
  const candidates = REGISTRY.classified.filter((c) => c.key === key);
  if (!candidates.length) return null;
  const digest = scenarioDigest(scenario);
  const own = candidates.find((c) => c.version === version);
  for (const c of own ? [own, ...candidates.filter((x) => x !== own)] : candidates) {
    const hit = c.scenarios.get(scenario.id);
    if (hit && hit.digest === digest) return { tier: hit.tier, from: c.version };
  }
  return null;
}

/** A scenario's tier, or null when no classified version holds this exact definition. */
export function tierFor(key: string, version: number, scenario: SuiteCase): Tier | null {
  return tierOf(key, version, scenario)?.tier ?? null;
}
