import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS, recoverySecret, sealRecovery } from "@/lib/auth/recovery.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { classifyAuthError } from "@/lib/auth/errors.ts";
import { isOAuthProvider, safeNext } from "@/lib/auth/redirects.ts";
import type { ProblemCode } from "../confirm/problems.ts";

/**
 * Every link that comes back from Supabase with a one-time `code` — a confirmation email,
 * a password reset, a Google or GitHub sign-in, or connecting one of those to an existing
 * account — lands here and is spent here.
 *
 * Before this existed, the server-side Supabase client sent every email link back with a
 * `code` (it uses PKCE), while `/auth/confirm` read only `token_hash`: a reset link said
 * "not valid" every time, and a confirmation link landed on the home page, which ignored it.
 *
 * `flow` was put on the return address by us when the link was asked for; it only decides
 * which page follows and which sentence a failure shows. It grants nothing: the session
 * comes from the code alone, and the destination is from a fixed list (`safeNext`).
 */
export type Flow = "signup" | "recovery" | "oauth" | "link";

export function flowOf(value: string | null): Flow {
  return value === "signup" || value === "recovery" || value === "link" ? value : "oauth";
}

export async function completeAuth(url: URL, flow: Flow): Promise<NextResponse> {
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  const problem = (code: ProblemCode, page = "/sign-in") => to(`${page}?problem=${code}`);
  const settings = (query: string) => to(`/settings/account?${query}`);

  // Supabase reports a refused link or a cancelled consent screen in the query string. The
  // description is the provider's wording and is never shown; it is matched, then dropped.
  const error = url.searchParams.get("error");
  if (error) {
    const errorCode = url.searchParams.get("error_code") ?? "";
    const description = url.searchParams.get("error_description") ?? "";
    if (flow === "link") {
      return settings(`problem=${classifyAuthError({ code: errorCode, message: description }) === "identity_taken" ? "identity_taken" : "link_failed"}`);
    }
    if (flow === "recovery") return problem("reset_expired");
    if (flow === "signup") return problem(/expired|invalid/i.test(errorCode + description) ? "link_spent" : "link_invalid");
    // GoTrue creates the account unconfirmed and emails the address when the provider has
    // not verified it (observed 2026-10-06, GitHub); that is a next step, not a cancellation.
    if (errorCode === "provider_email_needs_verification") return problem("oauth_verify_email");
    if (error === "access_denied") return problem("oauth_cancelled");
    if (/email/i.test(description)) return problem("oauth_no_email");
    return problem("oauth_failed");
  }

  const code = url.searchParams.get("code");
  if (!code) {
    if (flow === "link") return settings("problem=link_failed");
    return problem(flow === "recovery" ? "reset_expired" : flow === "signup" ? "link_invalid" : "oauth_failed");
  }

  const supabase = await sessionClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.user) {
    // The usual cause is a link opened in another browser than the one that asked for it:
    // the code is good but the verifier it pairs with lives in the first browser's cookies.
    // For a confirmation that still means the address was confirmed (Supabase only returns
    // a code after the token checked out); the person signs in by hand.
    if (flow === "signup") return problem("confirmed_sign_in");
    if (flow === "recovery") return problem("reset_expired");
    if (flow === "link") return settings("problem=link_failed");
    return problem("oauth_failed");
  }

  if (flow === "recovery") {
    // Spent with the PKCE verifier this browser holds: the link it asked for itself.
    (await cookies()).set(RECOVERY_COOKIE, sealRecovery({ userId: data.user.id, issuedAt: Date.now(), bound: true }, recoverySecret()), {
      ...RECOVERY_COOKIE_OPTIONS, secure: process.env.NODE_ENV === "production",
    });
    return to("/reset-password");
  }

  if (flow === "link") {
    const provider = url.searchParams.get("provider");
    const linked = isOAuthProvider(provider) && (data.user.identities ?? []).some((i) => i.provider === provider);
    if (!linked) return settings("problem=link_failed");
    await recordAudit(serviceClient(), {
      workspaceId: null,
      actorId: data.user.id,
      subjectUserId: data.user.id,
      action: "identity.linked",
      detail: { provider },
    });
    return settings(`linked=${provider}`);
  }

  return to(safeNext(url.searchParams.get("next")));
}
