import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS, recoverySecret, sealRecovery, sealRefreshToken } from "@/lib/auth/recovery.ts";
import { endThisBrowserSession } from "@/lib/auth/switch.ts";
import type { ProblemCode } from "./problems.ts";
import { completeAuth } from "../callback/handle.ts";

/**
 * Where a `token_hash` email link lands (custom templates; the default ones go to
 * `/auth/callback` with a PKCE code instead).
 *
 * A `token_hash` is not tied to the browser that asked for it: whoever holds the email can open
 * it anywhere. This route used to turn it into a session, so an attacker's own sign-in link —
 * a magic link they requested for their own account straight from the Auth API — signed a
 * victim's browser into the attacker's account, where the victim might then type an agent
 * credential (login CSRF, reproduced 2026-10-08). Now:
 *
 *   - a confirmation (`signup`, `email`, `email_change`) confirms the address and creates no
 *     session in this browser: the person signs in by hand, as themselves;
 *   - `recovery` is verified on the same kind of client and creates no session in this
 *     browser either: the verified session's refresh token is sealed into the fifteen-minute
 *     recovery context, which only the reset action opens, once (src/lib/auth/recovery.ts).
 *     It used to set the session cookies, so an attacker's own reset link signed a victim's
 *     browser into the attacker's account (security audit, 2026-10-11);
 *   - `magiclink` and `invite` are refused. Novera sends neither, so a link of either kind
 *     reaching here was made by someone else.
 *
 * The token is in the query string, so every answer is a redirect to a clean address.
 */
const CONFIRMATION: EmailOtpType[] = ["signup", "email", "email_change"];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // A reset link asked for before 2026-10-06 points here and carries a PKCE `code`, not a
  // `token_hash`. Only reset links were sent here with a code, so a code is spent as one.
  if (url.searchParams.has("code") || url.searchParams.has("error")) return completeAuth(url, "recovery");

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  // A code, never a message: `/sign-in` owns the words (./problems.ts). Whatever the outcome, the
  // page that says it is never skipped: /sign-in sends a signed-in browser on to its dashboard,
  // so a confirmation opened in a browser signed in as someone else landed in that account with
  // the confirmation unsaid (Round 2 audit, 2026-10-19). The browser's session ends first; this
  // route still never starts one.
  const failed = async (code: ProblemCode) => {
    await endThisBrowserSession();
    return NextResponse.redirect(new URL(`/sign-in?problem=${code}`, url.origin));
  };

  if (!tokenHash || !type || !/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash)) return failed("link_invalid");

  // Verified on a client that keeps no cookies: nothing below changes who this browser is
  // signed in as.
  const isolated = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });

  if (CONFIRMATION.includes(type)) {
    // The address is confirmed and that session is ended: this browser stays exactly as it
    // was — signed in as whoever it was, or not.
    const { data, error } = await isolated.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return failed("link_spent");
    if (data.session) await isolated.auth.signOut({ scope: "local" });
    return failed("email_confirmed");
  }

  if (type === "recovery") {
    const { data, error } = await isolated.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error || !data.user || !data.session?.refresh_token) return failed("reset_expired");
    // The reset belongs to the person in the link: whoever this browser held before is signed out.
    await endThisBrowserSession();
    const issuedAt = Date.now();
    const sealedRefresh = sealRefreshToken(data.session.refresh_token, data.user.id, issuedAt);
    (await cookies()).set(RECOVERY_COOKIE, sealRecovery({ userId: data.user.id, issuedAt, bound: false, sealedRefresh }, recoverySecret()), {
      ...RECOVERY_COOKIE_OPTIONS, secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(new URL("/reset-password", url.origin));
  }

  return failed("link_invalid");
}
