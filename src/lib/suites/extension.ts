import type { SuiteCase } from "../runner/types.ts";
import { buildPromotedSuite } from "../scenarios/promote.ts";
import { extensionDigest, suiteDigest } from "./digest.ts";

/**
 * A suite extension: an official suite, unchanged, with up to five of the workspace's own
 * approved scenarios run beside it.
 *
 * It is published as a new, immutable workspace suite version (0056) whose scenarios are the
 * base suite's, byte for byte and in order, followed by the workspace's. The base is never
 * touched: a report on the extension still shows, by digest, that the official scenarios ran
 * exactly as shipped, and separately which workspace scenarios ran beside them. Every workspace
 * scenario is one a named person approved (0022); 0071 refuses any other in the database.
 *
 * Pure: the server action reads the rows and writes the result.
 */

export const MAX_EXTENSION_SCENARIOS = 5;

/** The suite a workspace's extensions of one official version are filed under. */
export function extensionKey(base: { key: string; version: number }): string {
  return `${base.key}-v${base.version}-ext`;
}

/** "EU support agent conformity suite + 3 workspace scenarios". */
export function extensionName(base: { name: string }, scenarios: number): string {
  return `${base.name} + ${scenarios} workspace scenario${scenarios === 1 ? "" : "s"}`.slice(0, 120);
}

/** "eu-support v5 + 3 workspace scenarios", for a picker. */
export function extensionLabel(ext: { key: string; version: number; scenarios: number }): string {
  return `${ext.key} v${ext.version} + ${ext.scenarios} workspace scenario${ext.scenarios === 1 ? "" : "s"}`;
}

/** What an extension suite records about itself in `suites.provenance.extends`, frozen with the row. */
export interface ExtensionRecord {
  suite_id: string;
  key: string;
  version: number;
  name: string;
  /** How many leading scenarios are the base suite's. */
  base_scenarios: number;
  base_suite_digest: string;
  extension_digest: string;
  extension_case_ids: string[];
}

/** The `extends` record of a suite row's provenance, or null when the suite is no extension. */
export function readExtension(provenance: unknown): ExtensionRecord | null {
  const e = (provenance as { extends?: Partial<ExtensionRecord> } | null)?.extends;
  if (!e || typeof e !== "object") return null;
  if (typeof e.key !== "string" || typeof e.version !== "number" || typeof e.base_scenarios !== "number"
    || typeof e.base_suite_digest !== "string" || typeof e.extension_digest !== "string") return null;
  return {
    suite_id: String(e.suite_id ?? ""), key: e.key, version: e.version, name: String(e.name ?? e.key),
    base_scenarios: e.base_scenarios, base_suite_digest: e.base_suite_digest, extension_digest: e.extension_digest,
    extension_case_ids: Array.isArray(e.extension_case_ids) ? e.extension_case_ids.map(String) : [],
  };
}

/**
 * The extension's digests recomputed from a suite row, given its `extends` record: the base
 * part hashed as the base suite would be, the rest as an extension. A run declares these from
 * the row it will execute, never from the record alone.
 */
export function extensionDigestsOf(row: { cases: readonly SuiteCase[] }, ext: Pick<ExtensionRecord, "key" | "version" | "name" | "base_scenarios">): {
  baseSuiteDigest: string; extensionDigest: string; extensionCaseIds: string[];
} {
  const base = row.cases.slice(0, ext.base_scenarios);
  const added = row.cases.slice(ext.base_scenarios);
  return {
    baseSuiteDigest: suiteDigest({ key: ext.key, version: ext.version, name: ext.name, cases: [...base] }),
    extensionDigest: extensionDigest(added),
    extensionCaseIds: added.map((c) => c.id),
  };
}

export interface ExtensionDraft {
  draftId: string;
  status: string;
  scenario: SuiteCase;
  /** The draft row's own flags, which bar a scenario from a production agent. */
  destructive?: boolean;
  fixture_only?: boolean;
}

export type BuiltExtension =
  | {
      ok: true;
      key: string;
      name: string;
      version: number;
      cases: SuiteCase[];
      draftIds: string[];
      record: Omit<ExtensionRecord, "suite_id"> & { suite_id: string };
    }
  | { ok: false; errors: string[] };

/**
 * Assembles an extension, or every reason it cannot be. The base must be an official suite
 * (shipped, not a workspace's), and every workspace scenario an approved draft: a draft that is
 * still a draft, was rejected, or already sits in a suite version is refused here, never
 * skipped, so the person sees why the count is not what they ticked.
 */
export function buildExtension(input: {
  base: { id: string; key: string; version: number; name: string; cases: SuiteCase[]; workspace_id: string | null; approval?: string | null };
  drafts: ExtensionDraft[];
  /** The next free version of `extensionKey(base)` in this workspace. */
  version: number;
}): BuiltExtension {
  const { base, drafts } = input;
  const errors: string[] = [];
  if (base.workspace_id !== null || (base.approval && base.approval !== "curated")) {
    errors.push("Only an official Novera suite can be extended. To change your own suite, publish a new version of it.");
  }
  if (drafts.length === 0) errors.push("Choose at least one approved scenario to add.");
  if (drafts.length > MAX_EXTENSION_SCENARIOS) {
    errors.push(`An extension adds at most ${MAX_EXTENSION_SCENARIOS} scenarios to an official suite; ${drafts.length} were chosen. Build your own suite in the Suite Builder for more.`);
  }
  for (const d of drafts) {
    if (d.status !== "approved") {
      errors.push(`${d.scenario?.id ?? d.draftId} is ${d.status === "included" ? "already in a suite version" : d.status === "draft" || d.status === "needs_review" ? "not approved yet" : d.status}; only an approved scenario can be added.`);
    }
  }
  const baseIds = new Set(base.cases.map((c) => c.id));
  for (const d of drafts) {
    if (d.scenario && baseIds.has(d.scenario.id)) {
      errors.push(`${d.scenario.id} is already a scenario of ${base.key} v${base.version}. A workspace scenario must have its own id, so a finding names one test only.`);
    }
  }
  if (errors.length) return { ok: false, errors };

  // A flag on the draft row bars the scenario from a production agent even where the scenario
  // itself does not carry it: added, never removed.
  const added = drafts.map((d) => ({
    draftId: d.draftId,
    scenario: {
      ...d.scenario,
      ...(d.destructive ? { destructive: true } : {}),
      ...(d.fixture_only ? { fixture_only: true } : {}),
    } as SuiteCase,
  }));

  const key = extensionKey(base);
  const name = extensionName(base, drafts.length);
  // The same assembly and validator a promotion uses: duplicate ids refused, every case valid.
  const promoted = buildPromotedSuite({ key, name, version: input.version, baseCases: base.cases, approved: added });
  if (!promoted.ok) return { ok: false, errors: promoted.errors };

  // The base part is the stored rows, not a re-validated copy of them.
  const cases = [...base.cases, ...promoted.suite.cases.slice(base.cases.length)];
  const digests = extensionDigestsOf({ cases }, { key: base.key, version: base.version, name: base.name, base_scenarios: base.cases.length });
  return {
    ok: true, key, name, version: input.version, cases, draftIds: promoted.draftIds,
    record: {
      suite_id: base.id, key: base.key, version: base.version, name: base.name,
      base_scenarios: base.cases.length,
      base_suite_digest: digests.baseSuiteDigest,
      extension_digest: digests.extensionDigest,
      extension_case_ids: digests.extensionCaseIds,
    },
  };
}
