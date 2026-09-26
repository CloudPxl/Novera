import { createHash } from "node:crypto";
import { redact, NOT_DETECTED, REDACTION_POLICY_VERSION, type PiiKind } from "./pii.ts";

/**
 * Redaction for storage: the redacted fields, and a record of what was done that names
 * the original only by its hash. Server-side; `pii.ts` is the part a browser can run to
 * preview the same result.
 */

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** What a stored record says about its own redaction. */
export interface RedactionRecord {
  policy_version: number;
  counts: Partial<Record<PiiKind, number>>;
  /** SHA-256 of the text as submitted. The text itself is not kept. */
  original_hash: string;
  redacted_hash: string;
  not_detected: string;
}

export function redactForStorage(fields: Record<string, string>): {
  fields: Record<string, string>;
  record: RedactionRecord;
} {
  const out: Record<string, string> = {};
  const counts: Partial<Record<PiiKind, number>> = {};
  // Placeholders are numbered per field; the counts are summed across them.
  for (const [name, value] of Object.entries(fields)) {
    const r = redact(value);
    out[name] = r.text;
    for (const [k, n] of Object.entries(r.counts)) counts[k as PiiKind] = (counts[k as PiiKind] ?? 0) + (n ?? 0);
  }
  const canonical = (o: Record<string, string>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));
  return {
    fields: out,
    record: {
      policy_version: REDACTION_POLICY_VERSION,
      counts,
      original_hash: sha256(canonical(fields)),
      redacted_hash: sha256(canonical(out)),
      not_detected: NOT_DETECTED,
    },
  };
}
