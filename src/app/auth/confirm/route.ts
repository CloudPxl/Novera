import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { sessionClient } from "@/lib/supabase/server.ts";
import type { ProblemCode } from "./problems.ts";
import { completeAuth } from "../callback/handle.ts";

/**
 * Where the link in a confirmation email lands.
 *
 * Supabase sends a one-time token rather than a session, so the session is created
 * here and the token is spent in the process. The token travels in the query string
 * and therefore through the user's browser history and any referrer — so on success
 * this redirects to a clean URL rather than rendering anything at this address.
 */
const CONFIRMABLE: EmailOtpType[] = ["signup", "email", "email_change", "recovery", "invite", "magiclink"];

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  // A reset link asked for before 2026-10-06 points here and carries a PKCE `code`, not a
  // `token_hash` — this route rejected every one of them as "not valid". Only reset links
  // were sent here with a code, so a code is spent as a recovery.
  if (url.searchParams.has("code") || url.searchParams.has("error")) return completeAuth(url, "recovery");

  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;

  // A code, never a message. `/sign-in` owns the words, so a link someone was sent
  // cannot put a sentence of its own inside our alert box — see ./problems.ts.
  const failed = (code: ProblemCode) =>
    NextResponse.redirect(new URL(`/sign-in?problem=${code}`, url.origin));

  if (!tokenHash || !type || !CONFIRMABLE.includes(type)) {
    return failed("link_invalid");
  }

  const supabase = await sessionClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });

  if (error) {
    // Expired and already-used links are the common cases, and both are the user's
    // problem to solve the same way. The provider's wording is not shown.
    return failed(type === "recovery" ? "reset_expired" : "link_spent");
  }

  // Recovery signs the person in, which is the whole of what the token does. It must
  // land somewhere that lets them set a password: it used to redirect to
  // `/sign-in?mode=reset`, and the sign-in page has never read `mode` — so a recovery
  // link signed you in and bounced you to the dashboard with the password unchanged.
  const destination = type === "recovery" ? "/reset-password" : "/dashboard";
  return NextResponse.redirect(new URL(destination, url.origin));
}
