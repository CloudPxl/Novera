import type { SuiteCase } from "../runner/types.ts";
import { LOCALE_NAMES, isVariantLocale, localise } from "../suites/locales.ts";

/**
 * The scenarios a run sends, in the language its manifest declared.
 *
 * Shared by the run and a retest of one of its scenarios, so the two send the same words: a
 * retest exists to predict the run. English — a manifest with no `locale`, which is every run
 * before variants existed — returns the suite's scenarios untouched.
 *
 * The variants are recomputed from the registered sidecars and must reproduce the digest the
 * manifest declared before the run started. If they do not (a sidecar changed in between), the
 * run is refused rather than sent a test it never declared.
 */
export function declaredLocalisation(manifest: unknown, cases: readonly SuiteCase[]):
  | { ok: true; cases: SuiteCase[]; locale: string | null }
  | { ok: false; error: string } {
  const m = (manifest ?? null) as { locale?: unknown; locale_digest?: unknown; localised_case_ids?: unknown } | null;
  if (!m || m.locale === undefined || m.locale === null) return { ok: true, cases: [...cases], locale: null };
  if (!isVariantLocale(m.locale)) return { ok: false, error: `This run declared the language ${JSON.stringify(m.locale)}, which Novera does not send.` };
  const localised = localise(cases, m.locale);
  const declaredIds = Array.isArray(m.localised_case_ids) ? m.localised_case_ids.map(String) : null;
  if (localised.digest !== m.locale_digest || (declaredIds && declaredIds.join("\u0000") !== localised.localisedIds.join("\u0000"))) {
    return {
      ok: false,
      error: `The ${LOCALE_NAMES[m.locale]} variants changed after this run was declared, so it was stopped before sending a test it did not declare. Start a new run.`,
    };
  }
  return { ok: true, cases: localised.cases, locale: m.locale };
}
