import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sessionClient } from "@/lib/supabase/server.ts";

/**
 * Where the link in a confirmation email lands.
 *
 * Supabase sends a one-time token rather than a session, so the session is created
 * here and the token is spent in the process. The token travels in the query string
 * and therefore through the user's browser history and any referrer — so on success
 * this redirects to a clean URL rather than rendering anything at this address.
 */
const CONFIRMABLE: EmailOtpType[] = ["signup", "email_change", "recovery", "invite", "magiclink"];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  const failed = (reason: string) =>
    NextResponse.redirect(new URL(`/sign-in?problem=${encodeURIComponent(reason)}`, url.origin));

  if (!tokenHash || !type || !CONFIRMABLE.includes(type)) {
    return failed("That confirmation link is not valid. Ask for a new one.");
  }

  const supabase = await sessionClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired and already-used links are the common cases, and both are the user's
    // problem to solve the same way. The provider's wording is not shown.
    return failed("That confirmation link has expired or was already used. Ask for a new one.");
  }

  const destination = type === "recovery" ? "/sign-in?mode=reset" : "/dashboard";
  return NextResponse.redirect(new URL(destination, url.origin));
}
