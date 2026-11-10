import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * The bearer secret the browser worker presents to /api/internal/insight/*.
 *
 * Derived from NOVERA_ENCRYPTION_KEY the way the schedule clock's is (src/lib/schedules/secret.ts),
 * so the deployment needs no new variable and the two cannot drift apart. The worker is given the
 * derived value only (`npm run insight-worker:secret` prints it once); it reveals nothing about the
 * key. Changing the version label, or the encryption key, retires every worker's secret.
 */
export function workerSecret(raw = process.env.NOVERA_ENCRYPTION_KEY): string {
  if (!raw) throw new Error("NOVERA_ENCRYPTION_KEY is not set, so the browser worker cannot be authenticated.");
  return createHmac("sha256", `${raw}:insight-worker:v1`).update("novera-insight-worker").digest("base64url");
}

/** Whether an `Authorization` header carries the worker secret. Constant time. */
export function isWorkerRequest(header: string | null, raw?: string): boolean {
  const match = /^Bearer\s+(\S+)\s*$/.exec(header ?? "");
  if (!match) return false;
  let expected: string;
  try {
    expected = workerSecret(raw);
  } catch {
    return false;
  }
  const a = Buffer.from(match[1]);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
