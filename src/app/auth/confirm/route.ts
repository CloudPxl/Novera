import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { createClient, type EmailOtpType } from "@supabase/supabase-js";
import { sessionClient } from "@/lib/supabase/server.ts";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS, recoverySecret, sealRecovery } from "@/lib/auth/recovery.ts";
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
 *   - `recovery` creates a session, because setting a password needs one, but marks it
 *     unbound: the reset page names the account, and after the password is set this browser
 *     is signed out (src/lib/auth/recovery.ts);
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

  // A code, never a message: `/sign-in` owns the words (./problems.ts).
  const failed = (code: ProblemCode) => NextResponse.redirect(new URL(`/sign-in?problem=${code}`, url.origin));

  if (!tokenHash || !type || !/^[A-Za-z0-9_-]{8,256}$/.test(tokenHash)) return failed("link_invalid");

  if (CONFIRMATION.includes(type)) {
    // Verified on a client that keeps no cookies, then that session is ended: the address is
    // confirmed and this browser stays exactly as it was — signed in as whoever it was, or not.
    const isolated = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data, error } = await isolated.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error) return failed("link_spent");
    if (data.session) await isolated.auth.signOut({ scope: "local" });
    return failed("email_confirmed");
  }

  if (type === "recovery") {
    const supabase = await sessionClient();
    const { data, error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    if (error || !data.user) return failed("reset_expired");
    (await cookies()).set(RECOVERY_COOKIE, sealRecovery({ userId: data.user.id, issuedAt: Date.now(), bound: false }, recoverySecret()), {
      ...RECOVERY_COOKIE_OPTIONS, secure: process.env.NODE_ENV === "production",
    });
    return NextResponse.redirect(new URL("/reset-password", url.origin));
  }

  return failed("link_invalid");
}
