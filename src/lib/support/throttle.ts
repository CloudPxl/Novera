import { createHash } from "node:crypto";

/**
 * The parts of the throttle that are only arithmetic and hashing.
 *
 * Split from `rate-limit.ts` because that file reaches for `next/headers` and a
 * Supabase client, and neither exists in a test runner. The rules worth pinning down —
 * what an identifier reveals, how long someone is asked to wait, what they are told —
 * are all here, where they can be checked without a request.
 */

export interface Limit {
  /** How many requests one identifier may make in the window. */
  max: number;
  windowSeconds: number;
}

/** The public forms. Deliberately generous: a person with a real problem writes twice. */
export const SUPPORT_LIMIT: Limit = { max: 5, windowSeconds: 60 * 60 };
export const APPLY_LIMIT: Limit = { max: 3, windowSeconds: 60 * 60 };
/** Per network address, whatever email is typed. Room for an office behind one address. */
export const SUPPORT_ADDRESS_LIMIT: Limit = { max: 20, windowSeconds: 60 * 60 };
export const APPLY_ADDRESS_LIMIT: Limit = { max: 10, windowSeconds: 60 * 60 };

function salt(): string {
  // Reuses the key the rest of the product already requires rather than adding a new
  // secret to configure. Absent in a test or a local shell, where the hash only has
  // to be stable, not unguessable.
  return process.env.NOVERA_ENCRYPTION_KEY ?? "novera-local";
}

export function fingerprint(parts: Array<string | null | undefined>): string {
  const hash = createHash("sha256");
  hash.update(salt());
  for (const part of parts) hash.update(`\u0000${(part ?? "").toLowerCase().trim()}`);
  return hash.digest("hex").slice(0, 40);
}

/**
 * Whole minutes until the window turns over.
 *
 * Never zero: "try again in 0 minutes" is a refusal with no next step in it, and a
 * person reading it has done nothing wrong.
 */
export function windowResetMinutes(windowSeconds: number, now = Date.now()): number {
  const elapsed = Math.floor(now / 1000) % windowSeconds;
  return Math.max(1, Math.ceil((windowSeconds - elapsed) / 60));
}

/**
 * What a refused person is told.
 *
 * Never "rate limited", which is our vocabulary for our problem. It says when they can try
 * again. It used to offer an address at nover.space as the way through, but nover.space receives no
 * mail: the one route it named bounced. A message form also says that what was already sent
 * arrived, so nobody sends it again to be sure.
 */
export function refusalMessage(retryAfterMinutes: number, kind: "attempt" | "message" = "attempt"): string {
  const when = retryAfterMinutes <= 1
    ? "in a minute"
    : retryAfterMinutes < 60
      ? `in about ${retryAfterMinutes} minutes`
      : "in about an hour";
  return kind === "message"
    ? `That is more messages than this form takes at once — try again ${when}. Every message you already sent has reached us, so there is no need to send it again.`
    : `That is more attempts than this form takes at once — try again ${when}.`;
}

/**
 * What a caller does when the count cannot be read — the throttle's table or function is
 * unreachable. Chosen at every call site, never defaulted (audit R3: everything failed open):
 * `allow` where refusing would lock ordinary people out and the request is cheap or bounded
 * elsewhere; `refuse` where an uncounted request spends model quota, sends email or writes
 * rows that cannot be deleted.
 */
export type OnCountFailure = "allow" | "refuse";

export interface LimitDecision {
  allowed: boolean;
  /** Whole minutes until the window turns over. Only meaningful when refused after counting. */
  retryAfterMinutes: number;
  hits: number;
  /** False when the count could not be read; `allowed` then follows the caller's choice. */
  counted: boolean;
}

/** Pure: the decision from the throttle function's answer. */
export function decideLimit(
  answer: { data: unknown; error: unknown } | null,
  limit: Limit,
  options: { peek?: boolean; onError: OnCountFailure },
  now = Date.now(),
): LimitDecision {
  if (!answer || answer.error || typeof answer.data !== "number") {
    return { allowed: options.onError === "allow", retryAfterMinutes: 0, hits: 0, counted: false };
  }
  return {
    // A peek asks "is this identifier already over?", so the count it reads has not been
    // spent on this request and the boundary is one different from a hit.
    allowed: options.peek ? answer.data < limit.max : answer.data <= limit.max,
    retryAfterMinutes: windowResetMinutes(limit.windowSeconds, now),
    hits: answer.data,
    counted: true,
  };
}

/** What a person is told when the count could not be read and their request was refused for it. */
export const COUNT_UNAVAILABLE_MESSAGE =
  "We could not check this request against our limits just now, so it was not sent. Please try again in a minute.";
