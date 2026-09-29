import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The bearer secret the database's clock presents to /api/cron/tick.
 *
 * Derived from NOVERA_ENCRYPTION_KEY rather than configured separately, so the
 * deployment needs no new variable and the two cannot drift apart. An HMAC is one-way:
 * the copy kept in Supabase Vault reveals nothing about the key it came from. Changing
 * the version string, or the encryption key, retires it; `npm run schedules:install`
 * stores the new one.
 */
export function tickSecret(raw = process.env.NOVERA_ENCRYPTION_KEY): string {
  if (!raw) throw new Error("NOVERA_ENCRYPTION_KEY is not set, so the schedule clock cannot be authenticated.");
  return createHmac("sha256", `${raw}:cron-tick:v1`).update("novera-schedule-tick").digest("base64url");
}

/** Whether an `Authorization` header carries the tick secret. Constant time. */
export function isTickRequest(header: string | null, raw?: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/.exec(header ?? "");
  if (!match) return false;
  let expected: string;
  try {
    expected = tickSecret(raw);
  } catch {
    return false;
  }
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
