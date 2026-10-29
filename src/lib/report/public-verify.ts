import { contentHash, type Json } from "./hash.ts";
import { normaliseDigest } from "./canonical.ts";
import { gradingFundedBy } from "./build.ts";
import { scoreWithheldAs, type ReportPayload } from "./payload.ts";
import { LOCALE_NAMES, isVariantLocale } from "../suites/locale-names.ts";

/**
 * The public seal check at `/verify/<sha256>`: anyone holding a digest can ask whether Novera
 * sealed a report with it, without the report's link and without signing in.
 *
 * The link is a report's access control, so this page must answer "was this sealed, and does
 * the stored document still hash to it?" and say nothing a stranger could not already know from
 * the digest. The receipt is therefore an allow-list, built field by field from the sealed
 * payload: no token, no client or agent name, no workspace, run or policy identifier, no
 * transcript, input, reply, finding text, policy text or attestation. A customer's own suite is
 * named by its version only, because its name and key are the customer's words.
 *
 * Every field a later payload format added has its absence branch: a report sealed before a
 * field existed is never described as carrying it, and nothing is defaulted.
 *
 * Pure, so the page and the tests read the same receipt.
 */

// One digest rule for the server and the browser's file check: `canonical.ts` has no Node dependency.
export { DIGEST_PATTERN, normaliseDigest } from "./canonical.ts";

/** The only columns the public check reads. Never `token`, `workspace_id`, `run_id` or `revoked_by`. */
export const SEAL_COLUMNS = "payload, content_hash, created_at, revoked_at";

export interface SealRow {
  payload: unknown;
  content_hash: string;
  created_at: string | null;
  revoked_at: string | null;
}

/**
 * Built-in suites, named exactly as their files name them (checked against `data/suites` in
 * tests/public-verify.test.ts). A suite is shown by name only when both its key and its name
 * match one of these: a workspace can give its own suite any key, including one of these.
 */
export const BUILT_IN_SUITES: Readonly<Record<string, string>> = {
  "eu-support": "EU support agent conformity suite",
  "docs-support": "Documentation-grounded support agent suite",
  "eu-gdpr-support": "EU GDPR privacy support suite",
  "e-commerce-refund": "E-commerce refunds and withdrawal suite",
  "fintech-kyc": "Fintech support guardrails suite",
};

export type ReceiptSuite =
  | { builtIn: true; name: string; key: string; version: number }
  | { builtIn: false; version: number | null };

export type ReceiptChain =
  | { kind: "previous"; hash: string }
  | { kind: "first" }
  | { kind: "not_recorded" };

export interface ReceiptGrade {
  band: string;
  /** The score as sealed, or null where the payload holds none or the band withholds it. */
  score: number | null;
  /** "withheld" or "incomplete" when the band is a word rather than a letter. */
  shownAs: "withheld" | "incomplete" | null;
  threshold: number | null;
}

export interface ReceiptCounts {
  planned: number | null;
  passed: number | null;
  failed: number | null;
  /** Errored, disputed and unverifiable scenarios: ran, produced no verdict. */
  noResult: number | null;
  notRun: number | null;
}

export interface ReceiptDetails {
  /** `novera.format`, or null on a payload that does not state one. */
  format: number | null;
  sealedAt: string | null;
  /** `run.date` exactly as sealed. */
  runDate: string | null;
  suite: ReceiptSuite;
  /** One of `gradingFundedBy`'s sentences, or null when the payload holds anything else. */
  fundedBy: string | null;
  /** The run was against Novera's scripted fixture: test data, not a real agent. */
  testData: boolean;
  counts: ReceiptCounts;
  /** Null on a format that records no grade (format 1). */
  grade: ReceiptGrade | null;
  /**
   * Format 13 on: how many passes rest on one model's verdict, which a release gate reads as
   * incomplete evidence (G5). Null when the report states no such count — formats before 13,
   * which are read as they were sealed. Final audit D-1, 2026-10-28: the receipt showed
   * "A, 10/10" for a run no second model corroborated.
   */
  uncorroboratedPasses: number | null;
  chain: ReceiptChain;
  /** The digest of the report this one reissues, when it is a reissue. */
  reissueOf: string | null;
  /**
   * Format 15, on an extension only: the official suite it carried and its digest, and how many
   * workspace scenarios ran after it, with their digest. Only digests and a count: the workspace
   * scenarios' words never leave the report. Null when the report states none.
   */
  extension: { baseSuite: { name: string; key: string; version: number }; baseSuiteDigest: string; scenarios: number; extensionDigest: string } | null;
  /** Format 15, on a run in another language only: which, and how many scenarios were sent in it. */
  language: { name: string; localised: number; of: number } | null;
}

export type SealReceipt =
  | { state: "unknown"; digest: string }
  | { state: "withdrawn"; digest: string; withdrawnAt: string | null }
  | { state: "mismatch"; digest: string; sealedAt: string | null }
  | { state: "verified"; digest: string; details: ReceiptDetails };

/** `2026-10-13 09:41 UTC`, or null for a missing or unreadable timestamp. */
export function utcMinute(value: string | null | undefined): string | null {
  if (!value) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

const FUNDED_BY: ReadonlySet<string> = new Set([
  ...(["trial_free", "workspace_key", "plan_managed"] as const).map((source) => gradingFundedBy(source)),
  gradingFundedBy("plan_managed", "grant"),
  gradingFundedBy("plan_managed", "owner_grant"),
]);

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function count(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** `build.ts` writes `${name} (${key} v${version})`. */
export function receiptSuite(stated: unknown): ReceiptSuite {
  if (typeof stated !== "string") return { builtIn: false, version: null };
  const match = /^(.*) \(([^()\s]+) v(\d+)\)$/.exec(stated);
  if (!match) return { builtIn: false, version: null };
  const [, name, key, version] = match;
  if (Object.hasOwn(BUILT_IN_SUITES, key) && BUILT_IN_SUITES[key] === name) {
    return { builtIn: true, name, key, version: Number(version) };
  }
  return { builtIn: false, version: Number(version) };
}

/** Only an official suite is named, only digests that are digests, only a count. */
export function receiptExtension(value: unknown): ReceiptDetails["extension"] {
  const e = record(value);
  if (!e || typeof e.base_suite !== "string") return null;
  const match = /^([a-z0-9][a-z0-9-]*) v(\d+)$/.exec(e.base_suite);
  if (!match || !Object.hasOwn(BUILT_IN_SUITES, match[1])) return null;
  const baseSuiteDigest = normaliseDigest(e.base_suite_digest);
  const extensionDigest = normaliseDigest(e.extension_digest);
  const scenarios = count(e.scenarios);
  if (!baseSuiteDigest || !extensionDigest || scenarios === null) return null;
  return { baseSuite: { name: BUILT_IN_SUITES[match[1]], key: match[1], version: Number(match[2]) }, baseSuiteDigest, scenarios, extensionDigest };
}

export function receiptLanguage(value: unknown): ReceiptDetails["language"] {
  const l = record(value);
  if (!l || !isVariantLocale(l.code)) return null;
  const localised = count(l.localised);
  const of = count(l.of);
  if (localised === null || of === null) return null;
  return { name: LOCALE_NAMES[l.code], localised, of };
}

function receiptChain(previous: unknown): ReceiptChain {
  // Absent before format 7: the report makes no claim either way.
  if (previous === undefined) return { kind: "not_recorded" };
  if (previous === null) return { kind: "first" };
  const hash = normaliseDigest(previous);
  return hash ? { kind: "previous", hash } : { kind: "not_recorded" };
}

function receiptGrade(grade: unknown): ReceiptGrade | null {
  const g = record(grade);
  if (!g || typeof g.band !== "string") return null;
  const shownAs = scoreWithheldAs({ grade: { band: g.band } as ReportPayload["grade"] });
  return {
    band: g.band,
    score: shownAs ? null : count(g.score),
    shownAs,
    threshold: count(g.threshold),
  };
}

/** Whether the stored payload still hashes to the digest it was stored under. */
export function sealHolds(row: SealRow, digest: string): boolean {
  if (row.content_hash !== digest || !record(row.payload)) return false;
  try {
    return contentHash(row.payload as Json) === digest;
  } catch {
    return false;
  }
}

/**
 * The receipt for one digest, from the one row the lookup returned (or none).
 *
 * A withdrawn report says withdrawn and when, and nothing else: no hash check, no details. A
 * stored report that no longer hashes to its digest shows none of its contents, because they
 * are not what was sealed.
 */
export function buildReceipt(digest: string, row: SealRow | null): SealReceipt {
  if (!row) return { state: "unknown", digest };
  if (row.revoked_at) return { state: "withdrawn", digest, withdrawnAt: utcMinute(row.revoked_at) };
  const sealedAt = utcMinute(row.created_at);
  if (!sealHolds(row, digest)) return { state: "mismatch", digest, sealedAt };

  const payload = record(row.payload)!;
  const novera = record(payload.novera);
  const subject = record(payload.subject);
  const run = record(payload.run) ?? {};
  const coverage = record(payload.coverage) ?? {};
  const reissue = record(payload.reissue);

  return {
    state: "verified",
    digest,
    details: {
      format: count(novera?.format),
      sealedAt,
      runDate: typeof run.date === "string" ? run.date : null,
      suite: receiptSuite(run.suite),
      fundedBy: typeof run.grading_funded_by === "string" && FUNDED_BY.has(run.grading_funded_by) ? run.grading_funded_by : null,
      // The report page's rule: an environment that names the fixture is labelled test data.
      // Only the flag leaves this function, never the environment sentence.
      testData: typeof subject?.environment === "string" && /fixture/i.test(subject.environment),
      counts: {
        planned: count(coverage.planned),
        passed: count(coverage.passed),
        failed: count(coverage.failed),
        noResult: count(coverage.errored),
        notRun: count(coverage.not_run),
      },
      grade: receiptGrade(payload.grade),
      uncorroboratedPasses: count(record(run.corroboration)?.uncorroborated_passes),
      chain: receiptChain(run.previous_report_hash),
      reissueOf: reissue ? normaliseDigest(reissue.of) : null,
      // Absent before format 15: no claim either way.
      extension: receiptExtension(run.extension),
      language: receiptLanguage(run.locale),
    },
  };
}

/**
 * Structured data for the receipt page: what the page is and what made it. No price, no
 * Organization (there is no legal entity yet), and nothing about the report or its customer.
 */
export function receiptJsonLd(digest: string, origin = "https://www.nover.space"): Array<Record<string, unknown>> {
  return [
    {
      "@context": "https://schema.org",
      "@type": "ItemPage",
      name: "Novera seal receipt",
      url: `${origin}/verify/${digest}`,
      isPartOf: { "@type": "WebSite", name: "Novera", url: origin },
    },
    {
      "@context": "https://schema.org",
      "@type": "SoftwareApplication",
      name: "Novera",
      applicationCategory: "BusinessApplication",
      url: `${origin}/`,
    },
  ];
}
