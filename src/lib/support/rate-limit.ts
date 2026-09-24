import "server-only";
import { headers } from "next/headers";
import { serviceClient } from "@/lib/supabase/service.ts";
import { type Limit, windowResetMinutes } from "./throttle.ts";

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
 * And a failure to count is not a failure to serve. If the throttle itself is broken
 * the request goes through: the cost of being wrong in that direction is some model
 * calls, and the cost of being wrong in the other is turning away the first real
 * customer because a counter table was unreachable.
 */

export { fingerprint, refusalMessage, SUPPORT_LIMIT, APPLY_LIMIT } from "./throttle.ts";
export type { Limit } from "./throttle.ts";

/** The caller's address, as coarsely as the platform will give it. Never stored raw. */
export async function callerAddress(): Promise<string | null> {
  const list = await headers();
  return list.get("x-forwarded-for")?.split(",")[0]?.trim() ?? list.get("x-real-ip") ?? null;
}

export interface LimitResult {
  allowed: boolean;
  /** Whole minutes until the window turns over. Only meaningful when refused. */
  retryAfterMinutes: number;
  hits: number;
}

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
  options: { peek?: boolean } = {},
): Promise<LimitResult> {
  try {
    const { data, error } = await serviceClient().rpc(options.peek ? "throttle_peek" : "throttle_hit", {
      key: identifier,
      window_seconds: limit.windowSeconds,
    });

    if (error || typeof data !== "number") {
      return { allowed: true, retryAfterMinutes: 0, hits: 0 };
    }

    return {
      // A peek asks "is this identifier already over?", so the count it reads has not
      // been spent on this request and the boundary is one different from a hit.
      allowed: options.peek ? data < limit.max : data <= limit.max,
      retryAfterMinutes: windowResetMinutes(limit.windowSeconds),
      hits: data,
    };
  } catch {
    return { allowed: true, retryAfterMinutes: 0, hits: 0 };
  }
}
