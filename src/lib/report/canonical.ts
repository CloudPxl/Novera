/**
 * The seal's canonical form, with no Node dependency, so the browser and the server compute
 * the same bytes.
 *
 * `hash.ts` hashes this with `node:crypto`; the public file check on `/verify` hashes it with
 * Web Crypto. One function, so the two can never drift: tests/verify-drop.test.ts also holds it
 * byte for byte against a frozen copy of the original and against the seal inspector's snippet.
 *
 * Object keys sorted, no incidental whitespace, arrays left in their meaningful order.
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

/** A SHA-256 digest as `contentHash` writes it: 64 lowercase hex characters. */
export const DIGEST_PATTERN = /^[0-9a-f]{64}$/;

/** The digest in canonical form, or null when the input is not a SHA-256 digest. */
export function normaliseDigest(input: unknown): string | null {
  if (typeof input !== "string") return null;
  const candidate = input.trim().toLowerCase();
  return DIGEST_PATTERN.test(candidate) ? candidate : null;
}

/** The subset of `SubtleCrypto` the seal needs, so a test can pass Node's. */
export interface Sha256Digester {
  digest(algorithm: "SHA-256", data: Uint8Array<ArrayBuffer>): Promise<ArrayBuffer>;
}

/** SHA-256 of the canonical form, UTF-8, as lowercase hex: `contentHash`, computed with Web Crypto. */
export async function contentHashWeb(payload: Json, subtle: Sha256Digester): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalise(payload));
  const digest = new Uint8Array(await subtle.digest("SHA-256", bytes));
  let hex = "";
  for (const byte of digest) hex += byte.toString(16).padStart(2, "0");
  return hex;
}
