import { VARIANT_LOCALES, type Locale } from "./locale-names.ts";

/**
 * A suite as the run launcher offers it, and how it is named there. Browser-safe: the launcher is
 * a client component, and the counts arrive from the server (`suiteVariantCounts`).
 */
export interface LaunchSuite {
  id: string;
  name: string;
  key: string;
  version: number;
  caseCount: number;
  /** `suiteDigest` of the stored row: what the run's manifest will record. */
  digest?: string;
  /** Set for a suite extension: the official version it carries unchanged, and how many workspace scenarios follow. */
  extension?: { baseKey: string; baseVersion: number; scenarios: number } | null;
  /** How many of its scenarios have a variant in each language; none means English only. */
  variants?: { de: number; fr: number; ro: number } | null;
}

/** "eu-support v5 + 3 workspace scenarios (extension v1)", or the suite's own name. */
export function suiteOptionLabel(s: LaunchSuite): string {
  if (!s.extension) return `${s.name} v${s.version}`;
  const n = s.extension.scenarios;
  return `${s.extension.baseKey} v${s.extension.baseVersion} + ${n} workspace scenario${n === 1 ? "" : "s"} (extension v${s.version})`;
}

/** The languages a suite can be sent in besides English, with how many scenarios each covers. */
export function languagesOf(s: LaunchSuite | undefined): Array<{ code: Exclude<Locale, "en">; count: number }> {
  if (!s?.variants) return [];
  return VARIANT_LOCALES.map((code) => ({ code, count: s.variants![code] })).filter((l) => l.count > 0);
}
