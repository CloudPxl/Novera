"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { callerAddress, fingerprint, rateLimit, type LimitResult } from "@/lib/support/rate-limit.ts";
import {
  PILOT_ATTEMPT_LIMIT, PILOT_MESSAGES, hashPilotCode, normalisePilotCode, pilotAttemptsRefusal,
  pilotOutcomeMessage, readPilotOutcome, type PilotMessage,
} from "./pilot-codes.ts";

export interface PilotFormState {
  error?: string;
  notice?: string;
  link?: PilotMessage["link"];
}

const toState = (m: PilotMessage): PilotFormState =>
  m.tone === "notice" ? { notice: m.text } : { error: m.text, ...(m.link ? { link: m.link } : {}) };

/**
 * Redeems a pilot code from the active workspace (0075) for every workspace its owner owns (0076:
 * one pilot per owner, one pool of runs). The workspace comes from the signed-in
 * person's active workspace, checked against live membership with `billing.manage` (owner or
 * admin) — never from the form; the only field read is the code.
 *
 * Every attempt is counted before the code is hashed or looked up: five in fifteen minutes per
 * person, per workspace and per network address (salted hash, never the address). A count that
 * cannot be read refuses: a redemption writes rows that are never deleted, and an uncounted
 * attempt is a free guess.
 *
 * `redeem_pilot_code` then does everything in one transaction — the grant, the code's count,
 * the redemption, the billing trail and the workspace audit line (`billing.pilot_code_redeemed`,
 * with the grant, its runs and its end; never the code) — so a grant never exists without its
 * audit line.
 */
export async function redeemPilotCode(_prev: PilotFormState, form: FormData): Promise<PilotFormState> {
  const { user, workspace, role, context } = await requireWorkspace();
  // The pilot covers every workspace the owner owns (0076); an admin is told it is the owner's.
  const ownerViewing = role === "owner";
  const gated = await gate(user.id, workspace.id, "billing.manage");
  if ("error" in gated) return { error: gated.error };

  const raw = form.get("code");
  // An empty press is not an attempt.
  if (typeof raw !== "string" || !raw.trim()) return { error: PILOT_MESSAGES.empty };

  const address = await callerAddress();
  const counts = (await Promise.all([
    rateLimit(fingerprint(["pilot-code-person", user.id]), PILOT_ATTEMPT_LIMIT, { onError: "refuse" }),
    rateLimit(fingerprint(["pilot-code-workspace", workspace.id]), PILOT_ATTEMPT_LIMIT, { onError: "refuse" }),
    address ? rateLimit(fingerprint(["pilot-code-address", address]), PILOT_ATTEMPT_LIMIT, { onError: "refuse" }) : null,
  ])).filter((c): c is LimitResult => c !== null);
  if (counts.some((c) => !c.counted)) return { error: PILOT_MESSAGES.uncounted };
  const refused = counts.filter((c) => !c.allowed);
  if (refused.length) return { error: pilotAttemptsRefusal(Math.max(...refused.map((c) => c.retryAfterMinutes))) };

  const code = normalisePilotCode(raw);
  // A malformed code is answered like an unknown one: the format is public, the answer is the same.
  if (!code) return toState(pilotOutcomeMessage({ outcome: "invalid" }, context.profile.timezone, ownerViewing));

  const { data, error } = await gated.admin.rpc("redeem_pilot_code", {
    p_code_hash: hashPilotCode(code), p_workspace: workspace.id, p_user: user.id,
  });
  const outcome = error ? null : readPilotOutcome(data);
  if (!outcome) {
    console.error("[billing] pilot code could not be redeemed:", error?.message ?? "unexpected answer");
    return { error: PILOT_MESSAGES.failed };
  }

  if (outcome.outcome === "redeemed") {
    // The top bar's funding line changes on every page, not only this one.
    revalidatePath("/", "layout");
  }
  return toState(pilotOutcomeMessage(outcome, context.profile.timezone, ownerViewing));
}
