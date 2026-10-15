import { createHash } from "node:crypto";
import { canonicalise, type Json } from "./canonical.ts";

/**
 * Canonical serialisation + digest for a report payload.
 *
 * The hash printed on a report is what lets a recipient check that the document they
 * were sent matches the stored run, so serialisation has to be stable: object keys
 * sorted, no incidental whitespace, arrays left in their meaningful order.
 *
 * The canonical form lives in `canonical.ts`, which has no Node dependency, so the
 * browser's file check on `/verify` hashes exactly these bytes.
 */
export { canonicalise, type Json };

export function contentHash(payload: Json): string {
  return createHash("sha256").update(canonicalise(payload), "utf8").digest("hex");
}

export function verifyHash(payload: Json, expected: string): boolean {
  return contentHash(payload) === expected;
}
