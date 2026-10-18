import euSupportV5 from "../../../data/suites/eu-support-v5.json" with { type: "json" };
import euSupportV5Locales from "../../../data/suites/eu-support-v5.locales.json" with { type: "json" };
// Each sidecar is registered with its suite file, so a variant matches a scenario by its
// definition. `tests/block5-extensions-locales.test.ts` fails if a *.locales.json on disk is
// not listed here.
import euGdprSupportV1 from "../../../data/suites/eu-gdpr-support-v1.json" with { type: "json" };
import euGdprSupportV1Locales from "../../../data/suites/eu-gdpr-support-v1.locales.json" with { type: "json" };
import eCommerceRefundV1 from "../../../data/suites/e-commerce-refund-v1.json" with { type: "json" };
import eCommerceRefundV1Locales from "../../../data/suites/e-commerce-refund-v1.locales.json" with { type: "json" };
import fintechKycV1 from "../../../data/suites/fintech-kyc-v1.json" with { type: "json" };
import fintechKycV1Locales from "../../../data/suites/fintech-kyc-v1.locales.json" with { type: "json" };
import type { SuiteCase } from "../runner/types.ts";
import type { DeterministicCheck } from "../judge/checks.ts";
import { canonicalise, type Json } from "../report/canonical.ts";
import { validateSuite } from "./validate.ts";
import { localeDigest, scenarioDigest } from "./digest.ts";
import { LOCALES, LOCALE_NAMES, VARIANT_LOCALES, isLocale, isVariantLocale, type Locale, type VariantLocale } from "./locale-names.ts";

/**
 * Language variants: a scenario's customer messages written in German, French or Romanian.
 *
 * A variant lives in a sidecar beside its suite, `data/suites/<key>-v<version>.locales.json`,
 * never inside it, like a tiers sidecar: the suite and its digest are unchanged, and a run in
 * English is the run it always was. A run in another language declares, before it starts, the
 * locale and the digest of exactly the variant entries it will send (`RunManifest.locale_digest`);
 * a scenario without a variant in that language is sent in English, and the run says how many
 * were localised.
 *
 * What a variant may change is the customer's side only: `input`, `earlier_turns` (the same
 * number of turns, so a turn rule still names the same turn), `checks` and `turn_checks`. The
 * expectation, the assertions and every rule that is not about wording stay the suite's own. An
 * English text rule (`must_contain`, `must_match`…) applied to a German reply would fail it for
 * being German, so a variant of a scenario with one — on the conversation or on one turn — must
 * override `checks` (or `turn_checks`) with rules written for that language. An override keeps
 * every rule that is not about wording exactly as the suite has it, and `turn_checks` keeps
 * exactly the turns the suite rules, so a localised scenario is never a weaker test under the
 * same id.
 *
 * Server-only in practice: it hashes scenarios with `node:crypto` and imports suite files.
 */

export { LOCALES, VARIANT_LOCALES, LOCALE_NAMES, isLocale, isVariantLocale } from "./locale-names.ts";
export type { Locale, VariantLocale } from "./locale-names.ts";

/**
 * A requested locale, or a sentence saying why it is not one. Absent or empty means English,
 * which is what every run was before variants existed.
 */
export function parseLocale(raw: unknown): Locale | { error: string } {
  if (raw === undefined || raw === null || raw === "") return "en";
  if (isLocale(raw)) return raw;
  return { error: `The language must be one of ${LOCALES.join(", ")}.` };
}

export interface LocaleVariant {
  input: string;
  earlier_turns?: string[];
  checks?: DeterministicCheck[];
  /** The scenario's per-turn rules for this language: the same turns, only the text rules rewritten. */
  turn_checks?: Array<{ turn: number; checks: DeterministicCheck[] }>;
}

/** The sidecar contract: `{ suite, version, purpose, locales: { de: { <id>: variant }, fr, ro } }`. */
export interface LocaleSidecar {
  suite: string;
  version: number;
  purpose: string;
  locales: Partial<Record<VariantLocale, Record<string, LocaleVariant>>>;
}

const TEXT_CHECK_TYPES: ReadonlySet<string> = new Set(["must_contain", "must_not_contain", "must_match", "must_not_match"]);

/** A rule about the reply's wording, which means something only in the language it was written for. */
export function isTextCheck(check: { type: string }): boolean {
  return TEXT_CHECK_TYPES.has(check.type);
}

const VARIANT_KEYS: ReadonlySet<string> = new Set(["input", "earlier_turns", "checks", "turn_checks"]);

interface Registration {
  locales: unknown;
  suite: unknown;
}

const REGISTERED: Registration[] = [
  { locales: euSupportV5Locales, suite: euSupportV5 },
  { locales: euGdprSupportV1Locales, suite: euGdprSupportV1 },
  { locales: eCommerceRefundV1Locales, suite: eCommerceRefundV1 },
  { locales: fintechKycV1Locales, suite: fintechKycV1 },
];

export interface LocalisedVersion {
  key: string;
  version: number;
  /** Locale → scenario id → the definition's digest and its variant. */
  variants: Map<VariantLocale, Map<string, { digest: string; variant: LocaleVariant }>>;
}

const canon = (value: unknown) => canonicalise(value as Json);

/** A `turn_checks` list whose entries carry nothing but `turn` and `checks`. */
function isTurnRuleList(list: unknown): list is unknown[] {
  if (!Array.isArray(list)) return false;
  return list.every((t) => !!t && typeof t === "object" && !Array.isArray(t) && Object.keys(t).every((k) => k === "turn" || k === "checks"));
}

/**
 * Checks one variant against the scenario it localises. Every problem, never the first; an
 * empty list means it can be sent.
 */
export function variantProblems(base: SuiteCase, raw: unknown, where: string): string[] {
  const problems: string[] = [];
  const v = (raw ?? null) as Record<string, unknown> | null;
  if (!v || typeof v !== "object" || Array.isArray(v)) return [`${where}: a variant is an object with \`input\`.`];
  for (const k of Object.keys(v)) {
    if (!VARIANT_KEYS.has(k)) problems.push(`${where}: \`${k}\` cannot vary by language; only input, earlier_turns, checks and turn_checks can.`);
  }
  if (typeof v.input !== "string" || !v.input.trim()) problems.push(`${where}: \`input\` must be the customer's message in that language.`);
  else if (v.input.trim() === base.input.trim()) problems.push(`${where}: \`input\` is the English text unchanged.`);
  if (base.persona) problems.push(`${where}: a simulated customer continues in English, so a persona scenario has no variant.`);

  const baseTurns = base.earlier_turns ?? [];
  if (v.earlier_turns === undefined) {
    if (baseTurns.length) problems.push(`${where}: the scenario has ${baseTurns.length} earlier turn(s); the variant must translate each of them.`);
  } else if (!Array.isArray(v.earlier_turns) || v.earlier_turns.some((t) => typeof t !== "string" || !t.trim())) {
    problems.push(`${where}: \`earlier_turns\` must be a list of the customer's earlier messages.`);
  } else if (v.earlier_turns.length !== baseTurns.length) {
    problems.push(`${where}: \`earlier_turns\` has ${v.earlier_turns.length} message(s) where the scenario has ${baseTurns.length}; a turn rule must still name the same turn.`);
  }

  const baseText = (base.checks ?? []).some(isTextCheck);
  if (v.checks === undefined) {
    if (baseText) problems.push(`${where}: the scenario has an English text rule; the variant must override \`checks\` with rules for its own language.`);
  } else if (!Array.isArray(v.checks)) {
    problems.push(`${where}: \`checks\` must be a list of rules.`);
  }

  // A rule about wording on one turn is overridden the same way, turn for turn.
  const baseTurnText = (base.turn_checks ?? []).some((t) => t.checks.some(isTextCheck));
  if (v.turn_checks === undefined) {
    if (baseTurnText) problems.push(`${where}: the scenario has an English text rule on one turn; the variant must override \`turn_checks\` with rules for its own language.`);
  } else if (!isTurnRuleList(v.turn_checks)) {
    problems.push(`${where}: \`turn_checks\` must be a list of { turn, checks }.`);
  }

  const overridesChecks = Array.isArray(v.checks);
  const overridesTurns = isTurnRuleList(v.turn_checks);
  if (overridesChecks || overridesTurns) {
    // The same validator a suite file passes, on the scenario as it would be sent.
    const sent = { ...base, ...(overridesChecks ? { checks: v.checks } : {}), ...(overridesTurns ? { turn_checks: v.turn_checks } : {}) };
    const parsed = validateSuite({ key: "variant", name: "variant", version: 1, cases: [sent] });
    if (!parsed.ok) problems.push(...parsed.errors.map((e) => `${where}: ${e}`));
    else {
      const kept = (list: readonly { type: string }[]) => canon(list.filter((c) => !isTextCheck(c)));
      if (overridesChecks && kept(v.checks as { type: string }[]) !== kept(base.checks ?? [])) {
        problems.push(`${where}: an override may only rewrite text rules; every other rule must stay exactly as the scenario has it.`);
      }
      // Which turns are ruled, in what order, and every rule on them that is not about wording.
      const turnRules = (list: readonly { turn: number; checks: readonly { type: string }[] }[]) =>
        canon(list.map((t) => ({ turn: t.turn, checks: t.checks.filter((c) => !isTextCheck(c)) })));
      if (overridesTurns && turnRules(v.turn_checks as NonNullable<LocaleVariant["turn_checks"]>) !== turnRules(base.turn_checks ?? [])) {
        problems.push(`${where}: \`turn_checks\` may only rewrite text rules; the turns it rules and every other rule must stay exactly as the scenario has them.`);
      }
    }
  }
  return problems;
}

/**
 * Reads one registration, keeping only well-formed variants and recording everything that is
 * not. A malformed variant leaves its scenario in English rather than breaking a run; the test
 * holds `problems` at empty, so it never ships that way.
 */
export function parseLocaleRegistration(reg: Registration): { localised: LocalisedVersion | null; problems: string[] } {
  const problems: string[] = [];
  const l = (reg.locales ?? null) as Partial<LocaleSidecar> | null;
  const s = (reg.suite ?? null) as { key?: unknown; version?: unknown; cases?: unknown } | null;
  const where = `${String(l?.suite)} v${String(l?.version)} locales`;
  if (!l || typeof l.suite !== "string" || typeof l.version !== "number" || !l.locales || typeof l.locales !== "object") {
    return { localised: null, problems: [`${where}: not a locales sidecar ({ suite, version, purpose, locales }).`] };
  }
  if (typeof l.purpose !== "string" || !l.purpose.trim()) problems.push(`${where}: \`purpose\` must say what the variants are for.`);
  if (!s || s.key !== l.suite || s.version !== l.version || !Array.isArray(s.cases)) {
    return { localised: null, problems: [...problems, `${where}: registered beside a suite file that is not ${l.suite} v${l.version}.`] };
  }
  const cases = new Map((s.cases as SuiteCase[]).map((c) => [c.id, c]));
  const variants = new Map<VariantLocale, Map<string, { digest: string; variant: LocaleVariant }>>();
  for (const [locale, entries] of Object.entries(l.locales as Record<string, unknown>)) {
    if (!isVariantLocale(locale)) {
      problems.push(`${where}: ${JSON.stringify(locale)} is not one of ${VARIANT_LOCALES.join(", ")}.`);
      continue;
    }
    if (!entries || typeof entries !== "object" || Array.isArray(entries)) {
      problems.push(`${where}: ${locale} must map scenario ids to variants.`);
      continue;
    }
    const own = new Map<string, { digest: string; variant: LocaleVariant }>();
    for (const [id, raw] of Object.entries(entries as Record<string, unknown>)) {
      const base = cases.get(id);
      if (!base) { problems.push(`${where}: ${locale} ${id} is not a scenario of ${l.suite} v${l.version}.`); continue; }
      const found = variantProblems(base, raw, `${where}: ${locale} ${id}`);
      if (found.length) { problems.push(...found); continue; }
      const r = raw as LocaleVariant;
      own.set(id, {
        digest: scenarioDigest(base),
        variant: {
          input: r.input,
          ...(r.earlier_turns ? { earlier_turns: r.earlier_turns } : {}),
          ...(r.checks ? { checks: r.checks } : {}),
          ...(r.turn_checks ? { turn_checks: r.turn_checks } : {}),
        },
      });
    }
    variants.set(locale, own);
  }
  return { localised: { key: l.suite, version: l.version, variants }, problems };
}

function load(): { localised: LocalisedVersion[]; problems: string[] } {
  const localised: LocalisedVersion[] = [];
  const problems: string[] = [];
  for (const reg of REGISTERED) {
    const parsed = parseLocaleRegistration(reg);
    problems.push(...parsed.problems);
    if (parsed.localised) localised.push(parsed.localised);
  }
  return { localised, problems };
}

const REGISTRY = load();

/** Everything wrong with a registered sidecar. Empty in a shippable tree (tests hold it there). */
export function localeRegistryProblems(): readonly string[] {
  return REGISTRY.problems;
}

/** The localised suite versions, as registered. */
export function localisedVersions(): readonly LocalisedVersion[] {
  return REGISTRY.localised;
}

/**
 * The variant for one scenario in one language, or null. Matched by definition, not by id:
 * the scenario must be byte-identical to the one the variant was written for, so a workspace
 * suite that carries an official scenario unchanged (a pack, an extension) gets its variant,
 * and the same id with another definition never does.
 */
export function variantFor(scenario: SuiteCase, locale: Locale, registry: readonly LocalisedVersion[] = REGISTRY.localised): LocaleVariant | null {
  if (locale === "en") return null;
  const digest = scenarioDigest(scenario);
  for (const r of registry) {
    const hit = r.variants.get(locale)?.get(scenario.id);
    if (hit && hit.digest === digest) return hit.variant;
  }
  return null;
}

export interface Localised {
  locale: Locale;
  /** The scenarios as they will be sent: each localised one with its variant applied. */
  cases: SuiteCase[];
  /** The variant entries used, by scenario id — what `locale_digest` fingerprints. */
  used: Record<string, LocaleVariant>;
  /** Scenario ids sent in the locale, in suite order. */
  localisedIds: string[];
  /** `localeDigest` of `used`; null for English, or when no scenario has a variant. */
  digest: string | null;
}

/** Applies a language's variants to a suite's scenarios. English returns them untouched. */
export function localise(cases: readonly SuiteCase[], locale: Locale, registry: readonly LocalisedVersion[] = REGISTRY.localised): Localised {
  const used: Record<string, LocaleVariant> = {};
  const localisedIds: string[] = [];
  const out = cases.map((c) => {
    const v = variantFor(c, locale, registry);
    if (!v) return c;
    used[c.id] = v;
    localisedIds.push(c.id);
    return {
      ...c,
      input: v.input,
      ...(v.earlier_turns ? { earlier_turns: v.earlier_turns } : {}),
      ...(v.checks ? { checks: v.checks } : {}),
      ...(v.turn_checks ? { turn_checks: v.turn_checks } : {}),
    };
  });
  return { locale, cases: out, used, localisedIds, digest: localisedIds.length ? localeDigest(locale, used) : null };
}

/** How many of these scenarios have a variant in each language, for the run launcher. */
export function variantCounts(cases: readonly SuiteCase[], registry: readonly LocalisedVersion[] = REGISTRY.localised): Record<VariantLocale, number> {
  const counts = { de: 0, fr: 0, ro: 0 } as Record<VariantLocale, number>;
  for (const c of cases) {
    // One digest per scenario, however many languages are asked about.
    const digest = scenarioDigest(c);
    for (const locale of VARIANT_LOCALES) {
      if (registry.some((r) => r.variants.get(locale)?.get(c.id)?.digest === digest)) counts[locale]++;
    }
  }
  return counts;
}

const COUNTS_BY_SUITE = new Map<string, Record<VariantLocale, number>>();

/**
 * `variantCounts` for a stored suite row, remembered by its id: a suite version never changes
 * once it exists (0056), and the top bar asks on every page.
 */
export function suiteVariantCounts(suiteId: string, cases: readonly SuiteCase[]): Record<VariantLocale, number> {
  const known = COUNTS_BY_SUITE.get(suiteId);
  if (known) return known;
  const counts = variantCounts(cases);
  if (COUNTS_BY_SUITE.size > 500) COUNTS_BY_SUITE.clear();
  COUNTS_BY_SUITE.set(suiteId, counts);
  return counts;
}

/** "8 of 49 scenarios sent in German; the rest in English." — for the run page and the report. */
export function localeSentence(locale: string, localised: number, of: number): string {
  const name = isLocale(locale) ? LOCALE_NAMES[locale] : locale;
  if (localised >= of) return `All ${of} scenarios sent in ${name}.`;
  if (localised === 0) return `No scenario has a ${name} variant; all ${of} were sent in English.`;
  return `${localised} of ${of} scenarios sent in ${name}; the rest in English.`;
}
