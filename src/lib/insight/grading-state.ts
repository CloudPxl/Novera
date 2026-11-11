import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { PendingGrading } from "../judge/consensus.ts";

/**
 * An insight reply whose grading stopped only for Novera's grading capacity (the run's grading
 * holds, 0084, in the scan's shape). The worker already holds the captured reply, so nothing is
 * stored: the server answers "deferred" with the grading so far, sealed, and the worker posts the
 * same turn again after the wait — the same reply, never the prompt again. The next grading
 * resumes from the sealed state: the opinions given stand, the models that answered are not asked
 * again, and a tie is still settled only by a third vendor.
 *
 * Sealed under a key derived from NOVERA_ENCRYPTION_KEY with its own label, never the worker's
 * secret: the worker carries the state and must not be able to write one. The seal binds the
 * scan, the scenario and the SHA-256 of the redacted reply, so a state cannot be replayed onto
 * another reply, scenario or scan.
 */
export const INSIGHT_GRADING_ATTEMPTS = 3;
export const INSIGHT_REGRADE_AFTER_MS = 20_000;
/** The sealed state's size limit; a real one is a few kilobytes. */
export const GRADING_STATE_LIMIT_BYTES = 32 * 1024;

interface Sealed {
  v: 1;
  scan: string;
  scenario: string;
  reply: string;
  /** How many gradings this reply has had. */
  attempt: number;
  pending: PendingGrading;
}

function key(raw = process.env.NOVERA_ENCRYPTION_KEY): string {
  if (!raw) throw new Error("NOVERA_ENCRYPTION_KEY is not set, so a deferred grading cannot be sealed.");
  return createHmac("sha256", `${raw}:insight-grading:v1`).update("novera-insight-grading").digest("base64url");
}

export const replyDigest = (redactedReply: string) => createHash("sha256").update(redactedReply, "utf8").digest("hex");

export function sealGradingState(state: Omit<Sealed, "v">, raw?: string): string {
  const body = Buffer.from(JSON.stringify({ v: 1, ...state } satisfies Sealed), "utf8").toString("base64url");
  const mac = createHmac("sha256", key(raw)).update(body).digest("base64url");
  return `${body}.${mac}`;
}

/** The attempt count and grading so far, or null when the seal, its bindings or its shape do not hold. */
export function openGradingState(
  token: string,
  expect: { scan: string; scenario: string; reply: string },
  raw?: string,
): { attempt: number; pending: PendingGrading } | null {
  if (Buffer.byteLength(token, "utf8") > GRADING_STATE_LIMIT_BYTES) return null;
  const [body, mac, extra] = token.split(".");
  if (!body || !mac || extra !== undefined) return null;
  let expected: string;
  try {
    expected = createHmac("sha256", key(raw)).update(body).digest("base64url");
  } catch {
    return null;
  }
  const a = Buffer.from(mac);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: Sealed;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Sealed;
  } catch {
    return null;
  }
  if (parsed.v !== 1 || parsed.scan !== expect.scan || parsed.scenario !== expect.scenario || parsed.reply !== expect.reply) return null;
  if (!Number.isInteger(parsed.attempt) || parsed.attempt < 1 || parsed.attempt >= INSIGHT_GRADING_ATTEMPTS) return null;
  const p = parsed.pending;
  if (!p || !Array.isArray(p.opinions) || !Array.isArray(p.asked) || !Array.isArray(p.attempts)) return null;
  return { attempt: parsed.attempt, pending: p };
}
