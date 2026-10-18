import "server-only";
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { cameFromRecovery, RECOVERY_COOKIE, RECOVERY_COOKIE_OPTIONS, recoverySecret, sealRecovery } from "@/lib/auth/recovery.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { endBrowserSession, forgetWorkspaceChoice } from "@/lib/auth/switch.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { track } from "@/lib/analytics/track.ts";
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
 * comes from the code alone, the destination is from a fixed list (`safeNext`), and a
 * recovery context needs GoTrue's own `recovery` mark on the session.
 */
export type Flow = "signup" | "recovery" | "oauth" | "link" | "email";

/**
 * `email` is an emailed link whose kind is unknown: one Supabase sent to its Site URL root
 * because the return address was not on its allow list (src/proxy.ts). It may be a
 * confirmation or a password reset; GoTrue's `recovery` mark on the session tells them apart.
 */
export function flowOf(value: string | null): Flow {
  return value === "signup" || value === "recovery" || value === "link" || value === "email" ? value : "oauth";
}

export async function completeAuth(url: URL, flow: Flow): Promise<NextResponse> {
  const to = (path: string) => NextResponse.redirect(new URL(path, url.origin));
  // A link that could not be spent ends whatever session this browser held, so the sign-in page
  // that explains the failure is never skipped into an older account's dashboard (live test,
  // 2026-10-18: a new account's confirmation left the browser in the previous account). Linking
  // a provider is done from inside an account and keeps it.
  const problem = async (code: ProblemCode, page = "/sign-in") => {
    await endBrowserSession(await sessionClient());
    return to(`${page}?problem=${code}`);
  };
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
    if (flow === "email") return problem("email_link_failed");
    // GoTrue creates the account unconfirmed and emails the address when the provider has
    // not verified it (observed 2026-10-06, GitHub); that is a next step, not a cancellation.
    if (errorCode === "provider_email_needs_verification") return problem("oauth_verify_email");
    if (error === "access_denied") return problem("oauth_cancelled");
    if (/email/i.test(description)) return problem("oauth_no_email");
    return problem("oauth_failed");
  }

  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  if (!code && tokenHash && flow !== "link") {
    // An emailed link in the token_hash form, opened anywhere: /auth/confirm verifies it and
    // starts no session, so it works without this browser's PKCE verifier.
    const target = new URL("/auth/confirm", url.origin);
    for (const key of ["token_hash", "type", "next"]) {
      const value = url.searchParams.get(key);
      if (value) target.searchParams.set(key, value);
    }
    await forgetWorkspaceChoice();
    return NextResponse.redirect(target);
  }
  if (!code) {
    if (flow === "link") return settings("problem=link_failed");
    return problem(flow === "recovery" ? "reset_expired" : flow === "signup" || flow === "email" ? "link_invalid" : "oauth_failed");
  }

  const supabase = await sessionClient();
  const { data, error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError || !data.user) {
    // The usual cause is a link opened in another browser than the one that asked for it:
    // the code is good but the verifier it pairs with lives in the first browser's cookies.
    // For a confirmation that still means the address was confirmed (Supabase only returns
    // a code after the token checked out); the person signs in by hand.
    if (flow === "signup") return problem("confirmed_sign_in");
    // A reset link opened in another browser (a phone's mail app) than the one that asked for
    // it: the code is good, the verifier is not here. Said, rather than "expired".
    if (flow === "recovery") return problem("reset_other_browser");
    if (flow === "email") return problem("email_link_failed");
    if (flow === "link") return settings("problem=link_failed");
    return problem("oauth_failed");
  }

  // GoTrue's own mark decides whether this was a password reset, not the address it came back
  // to: a reset link Supabase returned to its Site URL root arrived as `flow=email` (or, before
  // 2026-10-12, as `signup`) and signed the person in at the dashboard with no way to set the
  // password they had asked to change.
  const recovered = cameFromRecovery(data.session?.access_token);
  if (flow === "recovery" || (recovered && flow !== "link")) {
    // `flow` is only a query parameter: the code from a sign-in or a link flow could be sent
    // here with `flow=recovery` to set a password without the current one. Only a session
    // GoTrue marked as recovered counts (security audit, 2026-10-11).
    if (!recovered) return problem("reset_expired");
    // Spent with the PKCE verifier this browser holds: the link it asked for itself.
    (await cookies()).set(RECOVERY_COOKIE, sealRecovery({ userId: data.user.id, issuedAt: Date.now(), bound: true }, recoverySecret()), {
      ...RECOVERY_COOKIE_OPTIONS, secure: process.env.NODE_ENV === "production",
    });
    await forgetWorkspaceChoice();
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

  // Whoever this browser belonged to before, the new session starts on its own default workspace.
  await forgetWorkspaceChoice();
  if (flow === "signup") await track("signup_confirmed", { userId: data.user.id, properties: { method: "email" } });
  return to(safeNext(url.searchParams.get("next")));
}
