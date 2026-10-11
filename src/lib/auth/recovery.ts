import { createHmac, timingSafeEqual } from "node:crypto";
import { open, seal, type Sealed } from "../crypto.ts";

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
 * any browser. A bound context sits beside the session the link created. An unbound one never
 * signs this browser in: the link is verified on a client that keeps no cookies, and that
 * session's refresh token travels only inside this cookie, encrypted, for the reset action to
 * spend once. So an attacker's own reset link can never put a victim's browser inside the
 * attacker's account (security audit, 2026-10-11).
 *
 * Pure apart from the clock and the key, so the rules are tested rather than trusted.
 */
export const RECOVERY_COOKIE = "nv_recovery";
export const RECOVERY_TTL_MS = 15 * 60 * 1000;

export interface RecoveryContext {
  userId: string;
  issuedAt: number;
  bound: boolean;
  /** Unbound only: the cookie-less recovery session's refresh token, sealed with AES-256-GCM. */
  sealedRefresh?: string;
}

function mac(secret: string, body: string): string {
  return createHmac("sha256", `recovery:${secret}`).update(body).digest("base64url");
}

export function sealRecovery(ctx: RecoveryContext, secret: string): string {
  const body = ctx.bound || !ctx.sealedRefresh
    ? `${ctx.userId}.${ctx.issuedAt}.${ctx.bound ? "b" : "u"}`
    : `${ctx.userId}.${ctx.issuedAt}.u.${ctx.sealedRefresh}`;
  return `${body}.${mac(secret, body)}`;
}

/** Seals the unbound session's refresh token to this user and this moment. */
export function sealRefreshToken(refreshToken: string, userId: string, issuedAt: number, key?: Buffer): string {
  return Buffer.from(JSON.stringify(seal(refreshToken, `recovery:${userId}:${issuedAt}`, key))).toString("base64url");
}

export function openRefreshToken(ctx: RecoveryContext, key?: Buffer): string | null {
  if (!ctx.sealedRefresh) return null;
  try {
    const sealed = JSON.parse(Buffer.from(ctx.sealedRefresh, "base64url").toString("utf8")) as Sealed;
    return open(sealed, `recovery:${ctx.userId}:${ctx.issuedAt}`, key);
  } catch {
    return null;
  }
}

/** The context, when the value is ours and fresh; otherwise null. Names its own user. */
export function readRecovery(value: string | null | undefined, secret: string, now = Date.now()): RecoveryContext | null {
  if (!value || value.length > 700) return null;
  const parts = value.split(".");
  if (parts.length !== 4 && parts.length !== 5) return null;
  const given = parts[parts.length - 1];
  const body = parts.slice(0, -1).join(".");
  const expected = Buffer.from(mac(secret, body));
  const actual = Buffer.from(given);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  const [id, issued, binding, sealedRefresh] = parts;
  const issuedAt = Number(issued);
  if (!id || !Number.isSafeInteger(issuedAt) || (binding !== "b" && binding !== "u")) return null;
  if (parts.length === 5 && (binding !== "u" || !/^[A-Za-z0-9_-]{16,500}$/.test(sealedRefresh))) return null;
  if (issuedAt > now + 60_000 || now - issuedAt > RECOVERY_TTL_MS) return null;
  return parts.length === 5 ? { userId: id, issuedAt, bound: false, sealedRefresh } : { userId: id, issuedAt, bound: binding === "b" };
}

/** The context, when the value is ours, for this user, and fresh; otherwise null. */
export function openRecovery(value: string | null | undefined, userId: string, secret: string, now = Date.now()): RecoveryContext | null {
  const ctx = readRecovery(value, secret, now);
  return ctx && ctx.userId === userId ? ctx : null;
}

/**
 * Whether a session came from a recovery link: GoTrue stamps `amr` with `recovery` when a PKCE
 * recovery code is exchanged (`otp` for a bare token_hash, `password`, `oauth` otherwise —
 * measured on the local GoTrue, 2026-10-11). Any other code arriving with `flow=recovery` is a
 * sign-in, and must not mint a context that sets a password without the current one.
 */
export function cameFromRecovery(accessToken: string | null | undefined): boolean {
  if (!accessToken) return false;
  try {
    const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8")) as { amr?: Array<{ method?: string }> };
    return Array.isArray(claims.amr) && claims.amr.some((a) => a?.method === "recovery");
  } catch {
    return false;
  }
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
