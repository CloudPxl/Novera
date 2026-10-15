import { normaliseDigest, type Json } from "./canonical.ts";
import type { SealReceipt } from "./public-verify.ts";

/**
 * The file check on `/verify`: a report file is read and hashed in the reader's browser, and
 * only digests are sent to Novera to look up. Pure, so the page and the tests read the same rules.
 *
 * The seal covers the payload and nothing else (`hash.ts`). A JSON export wraps the payload
 * with its link, the stated `content_hash`, the CI outcome and Novera's standing notice; none
 * of those is sealed, so editing them changes no digest, and the check says so.
 */

/** A report export is a few hundred kilobytes at most; anything this large is not one. */
export const MAX_REPORT_FILE_BYTES = 5 * 1024 * 1024;

export type FileProblem = "too_large" | "empty" | "not_json";

export type ReadReport =
  | { ok: false; problem: FileProblem }
  /** Valid JSON, but no object that could be a report's content: not a report, nothing to look up. */
  | { ok: true; shape: "none" }
  | {
      ok: true;
      shape: "export" | "payload";
      payload: Json;
      /** The digest the export states, when it states a well-formed one. */
      claimed: string | null;
      /** The export has a `content_hash` field that is not a SHA-256 digest. */
      claimedUnreadable: boolean;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * The report inside a file's text. `byteLength` is the file's size as the browser reports it,
 * checked before the text is parsed.
 *
 * An object with a `payload` object and the export's own fields (`novera_export` or
 * `content_hash`) is a JSON export; any other object is taken as a bare payload and hashed as
 * it is — if it is not a report, no sealed report has its digest, and the check says that.
 */
export function readReportFile(text: string, byteLength: number = new TextEncoder().encode(text).length): ReadReport {
  if (byteLength > MAX_REPORT_FILE_BYTES) return { ok: false, problem: "too_large" };
  // A UTF-8 byte-order mark is not part of the JSON; some editors write one.
  const body = text.replace(/^﻿/, "");
  if (body.trim() === "") return { ok: false, problem: "empty" };
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false, problem: "not_json" };
  }
  if (!isRecord(parsed)) return { ok: true, shape: "none" };

  const looksLikeExport = "payload" in parsed && ("novera_export" in parsed || "content_hash" in parsed);
  if (looksLikeExport) {
    if (!isRecord(parsed.payload)) return { ok: true, shape: "none" };
    const claimed = normaliseDigest(parsed.content_hash);
    return {
      ok: true,
      shape: "export",
      payload: parsed.payload as Json,
      claimed,
      claimedUnreadable: parsed.content_hash !== undefined && claimed === null,
    };
  }
  return { ok: true, shape: "payload", payload: parsed as Json, claimed: null, claimedUnreadable: false };
}

/** What `/api/verify/<digest>` answers, or `unavailable` when it could not be asked or could not read. */
export type LedgerAnswer = SealReceipt | { state: "unavailable"; digest: string };

export type FileVerdict = "matches" | "changed" | "withdrawn" | "stored_mismatch" | "not_sealed" | "unavailable";

/**
 * The verdict, from the digest the browser computed, the one the file states, and what the
 * ledger holds under each. The ledger is read for the stated digest only when it differs.
 *
 * The computed digest decides first, because it is the content in hand. Content that hashes to
 * a sealed report matches it, even if the export's unsealed `content_hash` field was edited.
 * "Changed after sealing" is said only when the file names a digest Novera did seal and its
 * content no longer hashes to it; a file whose stated digest Novera never sealed either is not
 * a sealed report, and is not called changed.
 */
export function fileVerdict(input: {
  computed: string;
  claimed: string | null;
  ledger: LedgerAnswer;
  claimedLedger: LedgerAnswer | null;
}): FileVerdict {
  const { computed, claimed, ledger, claimedLedger } = input;
  if (ledger.state === "unavailable") return "unavailable";
  if (ledger.state === "verified") return "matches";
  if (ledger.state === "withdrawn") return "withdrawn";
  if (ledger.state === "mismatch") return "stored_mismatch";
  if (claimed !== null && claimed !== computed) {
    if (!claimedLedger || claimedLedger.state === "unavailable") return "unavailable";
    if (claimedLedger.state !== "unknown") return "changed";
  }
  return "not_sealed";
}

/** A ledger answer as the page reads it: anything not in the receipt's shape is `unavailable`. */
export function readLedgerAnswer(digest: string, body: unknown): LedgerAnswer {
  if (!isRecord(body) || body.digest !== digest) return { state: "unavailable", digest };
  switch (body.state) {
    case "unknown":
    case "withdrawn":
    case "mismatch":
      return body as SealReceipt;
    case "verified":
      return isRecord(body.details) ? (body as SealReceipt) : { state: "unavailable", digest };
    default:
      return { state: "unavailable", digest };
  }
}

/** The address the browser asks, carrying nothing but the digest. */
export function ledgerPath(digest: string): string {
  return `/api/verify/${digest}`;
}
