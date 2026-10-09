import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Proof, held by one browser, that it arrived through a password-recovery link a moment ago.
 *
 * `/reset-password` used to accept any signed-in session, so a borrowed or hijacked session
 * could set a new password without the current one (app-wide audit, 2026-10-08). The page and
 * its action now also require this: an HMAC over the user id, the time it was issued and how
 * the link was spent, set only where a recovery link is spent, valid for fifteen minutes and
 * used once.
 *
 * `bound` says whether the link was spent with the PKCE verifier this browser holds (the link
 * it asked for itself) or as a bare `token_hash`, which anyone holding the email could open in
 * any browser. An unbound reset signs the browser out afterwards, so a link someone else was
 * sent can never leave this browser signed in to their account.
 *
 * Pure apart from the clock and the key, so the rules are tested rather than trusted.
 */
export const RECOVERY_COOKIE = "nv_recovery";
export const RECOVERY_TTL_MS = 15 * 60 * 1000;

export interface RecoveryContext {
  userId: string;
  issuedAt: number;
  bound: boolean;
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", `recovery:${secret}`).update(body).digest("base64url");
}

export function sealRecovery(ctx: RecoveryContext, secret: string): string {
  const body = `${ctx.userId}.${ctx.issuedAt}.${ctx.bound ? "b" : "u"}`;
  return `${body}.${mac(secret, body)}`;
}

/** The context, when the value is ours, for this user, and fresh; otherwise null. */
export function openRecovery(value: string | null | undefined, userId: string, secret: string, now = Date.now()): RecoveryContext | null {
  if (!value || value.length > 300) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [id, issued, binding, given] = parts;
  const body = `${id}.${issued}.${binding}`;
  const expected = Buffer.from(mac(secret, body));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const issuedAt = Number(issued);
  if (id !== userId || !Number.isSafeInteger(issuedAt) || (binding !== "b" && binding !== "u")) return null;
  if (issuedAt > now + 60_000 || now - issuedAt > RECOVERY_TTL_MS) return null;
  return { userId: id, issuedAt, bound: binding === "b" };
}

export function recoverySecret(env: Record<string, string | undefined> = process.env): string {
  const secret = env.NOVERA_ENCRYPTION_KEY;
  if (!secret) {
    if (env.NODE_ENV === "production") throw new Error("NOVERA_ENCRYPTION_KEY is required to seal a recovery context.");
    return "novera-local-recovery";
  }
  return secret;
}

export const RECOVERY_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: RECOVERY_TTL_MS / 1000,
};
