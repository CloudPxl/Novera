import { createHash } from "node:crypto";

/**
 * Which of a connection's keys may be asked now (2026-11-13).
 *
 * A provider limits each key (each organisation, strictly) by model: Groq's 429 names the model,
 * and a key at its limit on one model still answers on another. So a 429 cools that key for that
 * model until the provider's Retry-After (20 s when it gave none, never more than a minute), and
 * the next key is asked at once rather than waited for. A refused key (401/403) cools for every
 * model for ten minutes: a key that was revoked does not come back in a minute.
 *
 * Held in memory by a server instance, keyed by a digest of the key and never by the key, and
 * shared by every slice that instance runs: a key that ran out for one run has run out for the
 * next one too. Nothing here waits.
 */
export const KEY_COOLDOWN_DEFAULT_MS = 20_000;
export const KEY_COOLDOWN_MAX_MS = 60_000;
export const KEY_REFUSED_MS = 10 * 60_000;

/** A key's name in memory: the first 16 hex characters of its SHA-256. */
export function keyId(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

export class KeyCooldowns {
  private until = new Map<string, number>();

  /** A key at its limit for one model. */
  limited(key: string, model: string, retryAfterMs: number | undefined, now = Date.now()): void {
    const ms = Math.min(Math.max(retryAfterMs ?? KEY_COOLDOWN_DEFAULT_MS, 1_000), KEY_COOLDOWN_MAX_MS);
    this.set(`${keyId(key)}:${model}`, now + ms);
  }

  /** A key the provider refused, for every model. */
  refused(key: string, now = Date.now()): void {
    this.set(`${keyId(key)}:*`, now + KEY_REFUSED_MS);
  }

  /** A key that answered for this model is not at its limit for it, whatever an earlier 429 said. */
  answered(key: string, model: string): void {
    this.until.delete(`${keyId(key)}:${model}`);
  }

  /** Milliseconds until this key may be asked for this model again; 0 when it may now. */
  coolingFor(key: string, model: string, now = Date.now()): number {
    const id = keyId(key);
    const left = Math.max(this.until.get(`${id}:${model}`) ?? 0, this.until.get(`${id}:*`) ?? 0) - now;
    return left > 0 ? left : 0;
  }

  /** The keys that may be asked now, in the connection's order. */
  ready(keys: readonly string[], model: string, now = Date.now()): string[] {
    return keys.filter((k) => this.coolingFor(k, model, now) === 0);
  }

  /** How long until the first of these keys may be asked again. */
  soonest(keys: readonly string[], model: string, now = Date.now()): number {
    return keys.length ? Math.min(...keys.map((k) => this.coolingFor(k, model, now))) : 0;
  }

  private set(id: string, until: number): void {
    this.until.set(id, Math.max(this.until.get(id) ?? 0, until));
    if (this.until.size > 512) {
      const now = Date.now();
      for (const [k, v] of this.until) if (v <= now) this.until.delete(k);
    }
  }
}

/** One per server instance. */
export const instanceCooldowns = new KeyCooldowns();

/** A connection's keys, primary first. */
export function keysOf(connection: { apiKey: string; fallbackApiKey?: string; apiKeys?: string[] }): string[] {
  const keys = connection.apiKeys?.length ? connection.apiKeys : [connection.apiKey, connection.fallbackApiKey];
  return keys.filter((k, i, all): k is string => typeof k === "string" && k.length > 0 && all.indexOf(k) === i);
}
