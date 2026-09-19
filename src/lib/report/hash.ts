import { createHash } from "node:crypto";

/**
 * Canonical serialisation + digest for a report payload.
 *
 * The hash printed on a report is what lets a recipient check that the document they
 * were sent matches the stored run, so serialisation has to be stable: object keys
 * sorted, no incidental whitespace, arrays left in their meaningful order.
 */
export type Json = string | number | boolean | null | Json[] | { [k: string]: Json };

export function canonicalise(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalise).join(",")}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${canonicalise(value[k])}`)
    .join(",");
  return `{${body}}`;
}

export function contentHash(payload: Json): string {
  return createHash("sha256").update(canonicalise(payload), "utf8").digest("hex");
}

export function verifyHash(payload: Json, expected: string): boolean {
  return contentHash(payload) === expected;
}
