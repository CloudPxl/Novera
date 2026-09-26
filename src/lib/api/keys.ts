import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Workspace API keys: minting, hashing and reading one from a request.
 *
 * A key is `nvk_` followed by 43 base64url characters (32 random bytes). Only an HMAC of
 * it under the server's secret is stored, so the table alone opens nothing (0033). The
 * prefix — `nvk_` and the next eight characters — is kept so a person can tell two keys
 * apart in a list and match one to a leak report.
 */

export const KEY_PREFIX = "nvk_";
const KEY_PATTERN = /^nvk_[A-Za-z0-9_-]{43}$/;

export const SCOPES = ["read", "run"] as const;
export type Scope = (typeof SCOPES)[number];

function secret(raw = process.env.NOVERA_ENCRYPTION_KEY): string {
  // No fallback: a key hashed under a default secret is a key anyone with the source
  // can check guesses against.
  if (!raw) throw new Error("NOVERA_ENCRYPTION_KEY is not set, so API keys cannot be issued or checked.");
  return raw;
}

export function hashKey(key: string, raw?: string): string {
  return createHmac("sha256", `${secret(raw)}:api-keys:v1`).update(key, "utf8").digest("hex");
}

export function mintKey(raw?: string): { key: string; prefix: string; hash: string } {
  const key = `${KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
  return { key, prefix: key.slice(0, KEY_PREFIX.length + 8), hash: hashKey(key, raw) };
}

/** The key in an `Authorization: Bearer …` header, if it has the shape of one of ours. */
export function keyFromHeader(header: string | null): string | null {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  return match && KEY_PATTERN.test(match[1]) ? match[1] : null;
}

export function sameHash(a: string, b: string): boolean {
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}
