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

export const SCOPES = ["read", "run", "write", "responses", "probe"] as const;
export type Scope = (typeof SCOPES)[number];

/**
 * Every scope beyond `read` spends something or reaches further — a run, a model call, the
 * agent's own words, a single-scenario check — and each needs `read` beside it, to follow
 * what it started. The database refuses any other combination (0035, 0052, 0070); this is
 * the same rule, for a sentence before the insert.
 */
export function scopeProblem(scopes: readonly string[]): string | null {
  if (scopes.length === 0) return "A key needs at least one scope.";
  const unknown = scopes.find((s) => !(SCOPES as readonly string[]).includes(s));
  if (unknown) return `There is no ${unknown} scope.`;
  if (new Set(scopes).size !== scopes.length) return "A scope is listed twice.";
  const beyondRead = scopes.find((s) => s !== "read");
  if (beyondRead && !scopes.includes("read")) return `A key with the ${beyondRead} scope must also have the read scope.`;
  return null;
}

/** The scopes a key-creation form asked for: `read` always, the others only when ticked. */
export function scopesFromChoices(choices: { run?: boolean; write?: boolean; responses?: boolean; probe?: boolean }): Scope[] {
  return [
    "read",
    ...(choices.run ? ["run" as const] : []),
    ...(choices.write ? ["write" as const] : []),
    ...(choices.responses ? ["responses" as const] : []),
    ...(choices.probe ? ["probe" as const] : []),
  ];
}

/** How often a key's last use is written: once a minute at most, never on every request. */
export const LAST_USED_PRECISION_MS = 60_000;

/** Whether a request now should record the key's use, given when it was last recorded. */
export function shouldRecordUse(lastUsedAt: string | null, now = Date.now()): boolean {
  if (!lastUsedAt) return true;
  const then = Date.parse(lastUsedAt);
  return !Number.isFinite(then) || now - then >= LAST_USED_PRECISION_MS;
}

/** "Never used", or "Last used 3 hours ago" — to the minute, as it is recorded. */
export function lastUsedLabel(lastUsedAt: string | null | undefined, now = Date.now()): string {
  if (!lastUsedAt) return "Never used";
  const then = Date.parse(lastUsedAt);
  if (!Number.isFinite(then)) return "Never used";
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  const ago = (n: number, unit: string) => `Last used ${n} ${unit}${n === 1 ? "" : "s"} ago`;
  if (minutes < 1) return "Last used within the last minute";
  if (minutes < 60) return ago(minutes, "minute");
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return ago(hours, "hour");
  const days = Math.floor(hours / 24);
  if (days < 60) return ago(days, "day");
  return `Last used on ${new Date(then).toISOString().slice(0, 10)}`;
}

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
