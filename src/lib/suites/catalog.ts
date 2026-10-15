import type { SuiteCase } from "../runner/types.ts";
import { SEVERITIES } from "./validate.ts";
import { suiteDigest } from "./digest.ts";
import { TIERS, tierOf, type Tier } from "./tiers.ts";
import { nextVersion, previousVersion, suiteChangelog, type SuiteChangelog } from "./changelog.ts";

/**
 * The suite catalog: every built-in suite version, as stored, with what can be computed about
 * it. Every figure comes from a row passed in (or a registered tiers sidecar); none is typed.
 */

export type Severity = (typeof SEVERITIES)[number];
/** A tier, or "unclassified" for a scenario no classified version holds as written. */
export type TierBucket = Tier | "unclassified";
export const TIER_BUCKETS: readonly TierBucket[] = [...TIERS, "unclassified"];

export interface SuiteRow {
  id: string;
  key: string;
  version: number;
  name: string;
  cases: SuiteCase[];
}

export interface CatalogScenario {
  id: string;
  category: string;
  obligation: string;
  severity: string;
  tier: Tier | null;
  /** The classified version the tier was read from; differs from the scenario's own version when inherited. */
  tierFrom: number | null;
}

export interface CatalogVersion {
  id: string;
  key: string;
  version: number;
  name: string;
  digest: string;
  scenarios: CatalogScenario[];
  byTier: Record<TierBucket, number>;
  bySeverity: Record<Severity, number>;
  /** Against the next-lower stored version of the same key; null for the first. */
  changes: { from: number; log: SuiteChangelog } | null;
  supersededBy: number | null;
}

export interface CatalogSuite {
  key: string;
  /** The newest version's name. */
  name: string;
  versions: CatalogVersion[];
}

export function buildCatalog(rows: readonly SuiteRow[]): CatalogSuite[] {
  const versions = rows.map((row): CatalogVersion => {
    const cases = Array.isArray(row.cases) ? row.cases : [];
    const scenarios = cases.map((c): CatalogScenario => {
      const t = tierOf(row.key, row.version, c);
      return { id: c.id, category: c.category, obligation: c.obligation, severity: c.severity, tier: t?.tier ?? null, tierFrom: t?.from ?? null };
    });
    const byTier = Object.fromEntries(TIER_BUCKETS.map((b) => [b, 0])) as Record<TierBucket, number>;
    const bySeverity = Object.fromEntries(SEVERITIES.map((s) => [s, 0])) as Record<Severity, number>;
    for (const s of scenarios) {
      byTier[s.tier ?? "unclassified"]++;
      if (s.severity in bySeverity) bySeverity[s.severity as Severity]++;
    }
    const prev = previousVersion(rows, row);
    const next = nextVersion(rows, row);
    return {
      id: row.id, key: row.key, version: row.version, name: row.name,
      digest: suiteDigest({ key: row.key, version: row.version, name: row.name, cases }),
      scenarios, byTier, bySeverity,
      changes: prev ? { from: prev.version, log: suiteChangelog(prev, { cases }) } : null,
      supersededBy: next?.version ?? null,
    };
  });

  const keys = [...new Set(versions.map((v) => v.key))].sort((a, b) => a.localeCompare(b));
  return keys.map((key) => {
    const own = versions.filter((v) => v.key === key).sort((a, b) => b.version - a.version);
    return { key, name: own[0].name, versions: own };
  });
}

export interface CatalogFilter {
  tier: TierBucket | null;
  severity: Severity | null;
}

/** The filter in the address; anything unrecognised means "all", never an error. */
export function parseCatalogFilter(params: { tier?: string | string[]; severity?: string | string[] }): CatalogFilter {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const tier = one(params.tier);
  const severity = one(params.severity);
  return {
    tier: TIER_BUCKETS.includes(tier as TierBucket) ? (tier as TierBucket) : null,
    severity: (SEVERITIES as readonly string[]).includes(severity ?? "") ? (severity as Severity) : null,
  };
}

export function matchesFilter(s: CatalogScenario, f: CatalogFilter): boolean {
  return (!f.tier || (s.tier ?? "unclassified") === f.tier) && (!f.severity || s.severity === f.severity);
}
