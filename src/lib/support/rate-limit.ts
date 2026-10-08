import "server-only";
import { headers } from "next/headers";
import { serviceClient } from "@/lib/supabase/service.ts";
import { decideLimit, type Limit, type LimitDecision, type OnCountFailure } from "./throttle.ts";

/**
 * What it costs a stranger to make Novera do work.
 *
 * The two public forms accept anonymous POSTs, store a row and call a model. The
 * question this file answers is not "how do we block bad people" — it is "what happens
 * when one script finds the form", and the answer has to be *the product stays up for
 * the operator and the person with a real question still gets through*.
 *
 * The counter lives in Postgres. A Vercel function is not one process, so an in-memory
 * counter limits one lambda for as long as it happens to live — which is to say it
 * limits nothing, while looking exactly like protection.
 *
 * A failure to count is decided per caller, never by default (audit R3: every limit
 * once failed open). Where refusing would lock ordinary people out and the request is
 * cheap or bounded elsewhere — an API read, a sign-in — it goes through. Where an
 * uncounted request would spend model quota, send an email or write a row that cannot be
 * deleted, it is refused, or the expensive part is skipped while the person is still
 * served (the support form keeps the question and drafts nothing).
 */

export { fingerprint, refusalMessage, SUPPORT_LIMIT, APPLY_LIMIT, SUPPORT_ADDRESS_LIMIT, APPLY_ADDRESS_LIMIT, COUNT_UNAVAILABLE_MESSAGE } from "./throttle.ts";
export type { Limit, OnCountFailure } from "./throttle.ts";

/** The caller's address, as coarsely as the platform will give it. Never stored raw. */
export async function callerAddress(): Promise<string | null> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? null;
}

export type LimitResult = LimitDecision;

/**
 * Counts one request against a limit.
 *
 * The identifier is built by the caller so that a support message and a trial
 * application are counted separately — someone asking a question should not be turned
 * away because they also applied.
 */
export async function rateLimit(
  identifier: string,
  limit: Limit,
  options: { peek?: boolean; onError: OnCountFailure },
): Promise<LimitResult> {
  try {
    const answer = await serviceClient().rpc(options.peek ? "throttle_peek" : "throttle_hit", {
      key: identifier,
      window_seconds: limit.windowSeconds,
    });
    return decideLimit(answer, limit, options);
  } catch {
    return decideLimit(null, limit, options);
  }
}
