import euAiTransparencyV1 from "../../../data/suites/eu-ai-transparency-v1.json" with { type: "json" };
import euAiTransparencyV1Sources from "../../../data/suites/eu-ai-transparency-v1.sources.json" with { type: "json" };
// Each sidecar is registered with its suite file, as tiers are (`tiers.ts`), so a mapping can be
// checked against the scenarios it names. `tests/a50-requirements.test.ts` fails if a
// *.sources.json on disk is not listed here, or if a registered one has a problem.

/**
 * Requirement sources: for each scenario of a suite, the requirement it observes, by the kind of
 * source that requirement comes from — and what the suite does not observe at all.
 *
 * Article 50 pack, 2026-11-05. Kept *beside* a suite in `data/suites/<key>-v<version>.sources.json`,
 * never inside it: not part of the suite digest or a run's manifest, so a reference corrected
 * after a new guideline is a sidecar edit, not a new suite version. A report sealed from a run of
 * the suite freezes the mapping in force at sealing (payload format 16, `requirements`), so a later
 * correction never moves a document already issued. It organises evidence; it is not a legal
 * conclusion, and nothing rendered from it may read as one.
 *
 * Server-only in practice: it imports suite files. A page receives the sealed copy in the payload.
 */
export const SOURCE_LAYERS = [
  "binding_legislation",
  "commission_guidance",
  "voluntary_code",
  "customer_policy",
  "novera_scenario",
] as const;
export type SourceLayer = (typeof SOURCE_LAYERS)[number];

export function isSourceLayer(value: unknown): value is SourceLayer {
  return typeof value === "string" && (SOURCE_LAYERS as readonly string[]).includes(value);
}

export interface SourceRef {
  layer: SourceLayer;
  ref: string;
}

export interface SourcesGroup {
  id: string;
  label: string;
  refs: string;
  cases: string[];
}

export interface NotEvaluated {
  id: string;
  label: string;
  refs: string;
  sources: SourceRef[];
  reason: string;
}

/** The sidecar contract, as validated. */
export interface RequirementSources {
  suite: string;
  version: number;
  as_of: string;
  purpose: string;
  groups: SourcesGroup[];
  cases: Record<string, { sources: SourceRef[]; scope_limit: string }>;
  customer_policy: string;
  voluntary_code: string;
  not_evaluated: NotEvaluated[];
  boundary: string;
}

/** A mapped suite version: its sidecar, and what each mapped scenario is, from the suite file. */
export interface MappedVersion {
  sources: RequirementSources;
  /**
   * Scenario id → its obligation and expected behaviour, in the suite's order. A report reads the
   * mapping only for a run whose recorded scenarios match these, so a workspace suite that reused
   * the key with other scenarios is never filed under a mapping written for different tests.
   */
  scenarios: Map<string, { obligation: string; expected: string }>;
}

interface Registration {
  sources: unknown;
  suite: unknown;
}

const REGISTERED: Registration[] = [
  { sources: euAiTransparencyV1Sources, suite: euAiTransparencyV1 },
];

const nonEmpty = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

/**
 * Reads one registration, recording everything wrong with it. A sidecar with any problem is not
 * used at all — a report carries a whole mapping or none, never a partial one that reads as
 * complete — and the registry test holds `problems` at empty, so it never ships that way.
 */
export function parseSourcesRegistration(reg: Registration): { mapped: MappedVersion | null; problems: string[] } {
  const problems: string[] = [];
  const s = (reg.sources ?? null) as Record<string, unknown> | null;
  const suite = (reg.suite ?? null) as { key?: unknown; version?: unknown; cases?: unknown } | null;
  const where = `${String(s?.suite)} v${String(s?.version)} sources`;
  if (!s || typeof s !== "object" || !nonEmpty(s.suite) || typeof s.version !== "number") {
    return { mapped: null, problems: [`${where}: not a sources sidecar ({ suite, version, as_of, groups, cases, … }).`] };
  }
  if (!suite || suite.key !== s.suite || suite.version !== s.version || !Array.isArray(suite.cases)) {
    return { mapped: null, problems: [`${where}: registered beside a suite file that is not ${s.suite} v${s.version}.`] };
  }
  const suiteCases = suite.cases as Array<{ id: string; obligation: string; expected_behavior: string }>;
  const ids = new Set(suiteCases.map((c) => c.id));

  for (const field of ["as_of", "purpose", "customer_policy", "voluntary_code", "boundary"] as const) {
    if (!nonEmpty(s[field])) problems.push(`${where}: \`${field}\` must be a non-empty string.`);
  }
  if (nonEmpty(s.as_of) && !/^\d{4}-\d{2}-\d{2}$/.test(s.as_of)) problems.push(`${where}: \`as_of\` must be a date (YYYY-MM-DD).`);

  const refsOk = (list: unknown, at: string): list is SourceRef[] => {
    if (!Array.isArray(list) || list.length === 0) {
      problems.push(`${at}: \`sources\` must list at least one source.`);
      return false;
    }
    let ok = true;
    list.forEach((r: { layer?: unknown; ref?: unknown } | null, i) => {
      if (!isSourceLayer(r?.layer)) {
        problems.push(`${at}: source ${i + 1} has layer ${JSON.stringify(r?.layer)}, which is not one of ${SOURCE_LAYERS.join(", ")}.`);
        ok = false;
      }
      if (!nonEmpty(r?.ref)) {
        problems.push(`${at}: source ${i + 1} needs a non-empty \`ref\`.`);
        ok = false;
      }
    });
    return ok;
  };

  if (!Array.isArray(s.groups) || s.groups.length === 0) problems.push(`${where}: \`groups\` must list at least one group.`);
  const groupIds = new Set<string>();
  for (const g of (Array.isArray(s.groups) ? s.groups : []) as Array<Record<string, unknown>>) {
    const at = `${where} group ${String(g?.id)}`;
    if (!nonEmpty(g?.id) || !nonEmpty(g?.label) || !nonEmpty(g?.refs)) problems.push(`${at}: needs a non-empty id, label and refs.`);
    if (nonEmpty(g?.id) && groupIds.has(g.id)) problems.push(`${at}: listed twice.`);
    if (nonEmpty(g?.id)) groupIds.add(g.id);
    if (!Array.isArray(g?.cases) || g.cases.length === 0) problems.push(`${at}: must name at least one scenario.`);
    for (const id of (Array.isArray(g?.cases) ? g.cases : []) as unknown[]) {
      if (typeof id !== "string" || !ids.has(id)) problems.push(`${at}: ${String(id)} is not a scenario of ${s.suite} v${s.version}.`);
    }
  }

  const cases = (s.cases && typeof s.cases === "object" && !Array.isArray(s.cases) ? s.cases : null) as Record<string, Record<string, unknown>> | null;
  if (!cases) problems.push(`${where}: \`cases\` must map scenario ids to their sources.`);
  for (const [id, entry] of Object.entries(cases ?? {})) {
    const at = `${where} ${id}`;
    if (!ids.has(id)) problems.push(`${at}: not a scenario of ${s.suite} v${s.version}.`);
    refsOk(entry?.sources, at);
    if (!nonEmpty(entry?.scope_limit)) problems.push(`${at}: \`scope_limit\` must say what the scenario does not observe.`);
  }
  // Every scenario is mapped: a matrix that silently omits one reads as covering the suite.
  for (const c of suiteCases) if (cases && !(c.id in cases)) problems.push(`${where}: ${c.id} has no sources.`);

  if (!Array.isArray(s.not_evaluated)) problems.push(`${where}: \`not_evaluated\` must be a list (empty when the suite observes everything it names).`);
  for (const n of (Array.isArray(s.not_evaluated) ? s.not_evaluated : []) as Array<Record<string, unknown>>) {
    const at = `${where} not evaluated ${String(n?.id)}`;
    if (!nonEmpty(n?.id) || !nonEmpty(n?.label) || !nonEmpty(n?.refs) || !nonEmpty(n?.reason)) {
      problems.push(`${at}: needs a non-empty id, label, refs and reason.`);
    }
    refsOk(n?.sources, at);
  }

  if (problems.length) return { mapped: null, problems };
  const sources = s as unknown as RequirementSources;
  const scenarios = new Map(suiteCases.map((c) => [c.id, { obligation: c.obligation, expected: c.expected_behavior }]));
  return { mapped: { sources, scenarios }, problems };
}

function load(): { mapped: MappedVersion[]; problems: string[] } {
  const mapped: MappedVersion[] = [];
  const problems: string[] = [];
  for (const reg of REGISTERED) {
    const parsed = parseSourcesRegistration(reg);
    problems.push(...parsed.problems);
    if (!parsed.mapped) continue;
    const { suite, version } = parsed.mapped.sources;
    if (mapped.some((m) => m.sources.suite === suite && m.sources.version === version)) {
      problems.push(`${suite} v${version} sources: registered twice.`);
      continue;
    }
    mapped.push(parsed.mapped);
  }
  return { mapped, problems };
}

const REGISTRY = load();

/** Every registered, valid sources sidecar. */
export function mappedVersions(): readonly MappedVersion[] {
  return REGISTRY.mapped;
}

/** Everything wrong with a registered sidecar. Empty in a shippable tree (tests hold it there). */
export function sourcesRegistryProblems(): readonly string[] {
  return REGISTRY.problems;
}

/**
 * The mapping for exactly this suite version, or null. No fallback to another version: a mapping
 * names scenarios by id, and the same id in another version can be another test.
 */
export function sourcesFor(key: string, version: number): MappedVersion | null {
  return REGISTRY.mapped.find((m) => m.sources.suite === key && m.sources.version === version) ?? null;
}
