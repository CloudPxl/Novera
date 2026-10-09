"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionClient } from "@/lib/supabase/server.ts";
import { COUNT_UNAVAILABLE_MESSAGE, rateLimit } from "@/lib/support/rate-limit.ts";
import { fingerprint, refusalMessage, type Limit } from "@/lib/support/throttle.ts";
import { callerAddress } from "@/lib/support/rate-limit.ts";
import { authErrorMessage, classifyAuthError } from "@/lib/auth/errors.ts";
import { appOrigin, isOAuthProvider, PROVIDER_LABEL, safeNext } from "@/lib/auth/redirects.ts";
import { enabledProviders } from "@/lib/auth/providers.ts";
import { track } from "@/lib/analytics/track.ts";

export interface AuthState {
  error?: string;
  notice?: string;
  /**
   * Supabase accepted a sign-up or a resend for this address. The form then shows what to do
   * while waiting — resend, use another address, sign in another way — instead of a sentence
   * that disappears. The address is what the person typed, shown back to them only.
   */
  awaiting?: string;
  /** Sign-in was refused because this address is not confirmed yet: offer a new link for it. */
  unconfirmed?: string;
}

/** Supabase's own minimum. Enforced when a password is *set*, never when it is used. */
const PASSWORD_MIN = 8;

/**
 * Failed sign-ins per address, per hour.
 *
 * Generous, because the cost of being wrong is a person locked out of their own
 * evidence. Only failures count and a success never does, so someone who simply
 * mistypes twice is unaffected. This workspace holds customers' encrypted model keys;
 * an unmetered password field in front of that is the part worth closing.
 */
const SIGN_IN_LIMIT: Limit = { max: 10, windowSeconds: 60 * 60 };
/** Each of these sends an email to whatever address was typed. */
const RESET_LIMIT: Limit = { max: 3, windowSeconds: 60 * 60 };
const SIGN_UP_LIMIT: Limit = { max: 5, windowSeconds: 60 * 60 };
const RESEND_LIMIT: Limit = { max: 3, windowSeconds: 60 * 60 };

function readCredentials(
  form: FormData,
  { enforceMinimum }: { enforceMinimum: boolean },
): { email: string; password: string } | string {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email address and a password.";
  if (email.length > 254) return "That is longer than an email address can be.";
  // Only when a password is being set. Applying it on sign-in would lock out an
  // account created before the minimum existed, by rejecting the correct password.
  if (enforceMinimum && password.length < PASSWORD_MIN) {
    return `Use a password of at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > 200) return "That is longer than a password field accepts.";
  return { email, password };
}

/** Where emailed links point: this deployment's own address, never one a request supplied. */
async function origin(): Promise<string> {
  return appOrigin((await headers()).get("origin"));
}

/** Counts one email-sending request; refuses when the count cannot be read. */
async function emailAllowance(kind: string, email: string, limit: Limit): Promise<string | null> {
  const counted = await rateLimit(fingerprint([kind, email, await callerAddress()]), limit, { onError: "refuse" });
  if (!counted.counted) return COUNT_UNAVAILABLE_MESSAGE;
  if (!counted.allowed) return refusalMessage(counted.retryAfterMinutes);
  return null;
}

/**
 * One action for every mode, branching on a hidden field.
 *
 * Swapping the action function passed to useActionState does not reliably rebind it,
 * so a user who toggled to "Sign in" was still running sign-up. Reading the mode from
 * the submitted form removes that class of bug entirely, and the form keeps working
 * without JavaScript.
 */
export async function authenticate(prev: AuthState, form: FormData): Promise<AuthState> {
  const mode = String(form.get("mode"));
  if (mode === "signup") return signUp(prev, form);
  if (mode === "reset") return requestPasswordReset(prev, form);
  if (mode === "resend") return resendConfirmation(prev, form);
  if (mode === "oauth") return continueWithProvider(prev, form);
  return signIn(prev, form);
}

async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form, { enforceMinimum: false });
  if (typeof credentials === "string") return { error: credentials };

  const who = fingerprint(["signin", credentials.email, await callerAddress()]);
  // Allowed when the count cannot be read: refusing would lock everyone out, the operator
  // included, and Supabase Auth limits password attempts per address on its own.
  const limit = await rateLimit(who, SIGN_IN_LIMIT, { peek: true, onError: "allow" });
  if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };

  const { error } = await (await sessionClient()).auth.signInWithPassword(credentials);

  if (error) {
    // Counted only on failure: a person who mistypes once and then signs in has spent
    // nothing, and the limit is about guessing rather than about signing in.
    await rateLimit(who, SIGN_IN_LIMIT, { onError: "allow" });
    const kind = classifyAuthError(error);
    // Supabase says "not confirmed" only after the password matched, so this tells the
    // person nothing a stranger without the password could learn — and it is the one case
    // where "do not match" would leave them stuck, retyping a correct password.
    if (kind === "not_confirmed") return { error: authErrorMessage(kind, "signin"), unconfirmed: credentials.email };
    if (kind === "rate_limited") return { error: authErrorMessage(kind, "signin") };
    // A wrong password and an unknown address read the same — saying which would confirm
    // whether an account exists.
    return { error: authErrorMessage("invalid_credentials", "signin") };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(String(form.get("next") ?? "")));
}

/**
 * The neutral answer to "did that address already have an account".
 *
 * Supabase answers an address that is already confirmed with `user_already_exists` (or,
 * with its enumeration protection on, a session-less success that sends nothing). Either
 * way the person reads the same thing a new address does.
 */
const NEUTRAL_SIGNUP =
  "If that address is new, a confirmation link has been handed to our email provider. If you already have an account, no email is sent — sign in instead.";

async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form, { enforceMinimum: true });
  if (typeof credentials === "string") return { error: credentials };

  const refused = await emailAllowance("signup", credentials.email, SIGN_UP_LIMIT);
  if (refused) return { error: refused };

  const { data, error } = await (await sessionClient()).auth.signUp({
    ...credentials,
    // Without this the link went to Supabase's Site URL root, where nothing spent its code.
    options: { emailRedirectTo: `${await origin()}/auth/callback?flow=signup` },
  });

  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "already_registered") return { notice: NEUTRAL_SIGNUP, awaiting: credentials.email };
    // Logged by kind and status only: never the address, never a token.
    if (kind === "unknown" || kind === "email_send_failed") console.error(`[auth] sign-up refused: ${kind} (${error.status ?? "?"} ${error.code ?? ""})`);
    return { error: authErrorMessage(kind, "signup") };
  }

  await track("signup_started", { userId: data.user?.id, properties: { method: "email" } });
  if (!data.session) return { notice: NEUTRAL_SIGNUP, awaiting: credentials.email };

  // Only when confirmations are switched off: Supabase signs the person straight in.
  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * A new confirmation link, for a person whose first one did not arrive or expired.
 *
 * Answers the same whether or not the address is waiting for confirmation — Supabase does,
 * and saying which would tell a stranger whether an account exists. The earlier link stops
 * working once a new one is sent.
 */
async function resendConfirmation(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254) return { error: "Enter the email address you signed up with." };

  const refused = await emailAllowance("resend", email, RESEND_LIMIT);
  if (refused) return { error: refused, awaiting: email };

  const { error } = await (await sessionClient()).auth.resend({
    type: "signup",
    email,
    options: { emailRedirectTo: `${await origin()}/auth/callback?flow=signup` },
  });
  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "unknown" || kind === "email_send_failed") console.error(`[auth] resend refused: ${kind} (${error.status ?? "?"} ${error.code ?? ""})`);
    return { error: authErrorMessage(kind, "resend"), awaiting: email };
  }
  return {
    notice: "If that address is waiting for confirmation, a new link has been handed to our email provider. Links in earlier emails no longer work.",
    awaiting: email,
  };
}

/**
 * Sends a password reset link.
 *
 * Answers the same way whether or not the address has an account, for the same reason
 * sign-up does — except when the email could not be sent at all. That used to be swallowed
 * and the person told "a reset link is on its way" over a 500 from the mail server; now they
 * are told it was not sent, and where else to go.
 */
async function requestPasswordReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email || email.length > 254) return { error: "Enter the email address you signed up with." };

  const refused = await emailAllowance("reset", email, RESET_LIMIT);
  if (refused) return { error: refused };

  const { error } = await (await sessionClient()).auth.resetPasswordForEmail(email, {
    redirectTo: `${await origin()}/auth/callback?flow=recovery`,
  });
  if (error) {
    const kind = classifyAuthError(error);
    if (kind === "unknown" || kind === "email_send_failed") console.error(`[auth] reset refused: ${kind} (${error.status ?? "?"} ${error.code ?? ""})`);
    if (kind === "rate_limited" || kind === "email_send_failed" || kind === "address_not_allowed") {
      return { error: authErrorMessage(kind, "reset") };
    }
  }

  return {
    notice:
      "If that address has an account, a reset link has been handed to our email provider. The link signs you in once and asks for a new password; it expires, and using it ends any other session.",
  };
}

/**
 * Google or GitHub. The button submits here; the person is sent to Supabase, which sends
 * them to the provider and back to `/auth/callback?flow=oauth` with a one-time code.
 *
 * Offered only once Supabase reports the provider enabled — a button that leads to a JSON
 * error on Supabase's domain is worse than no button. The verifier for the code is set as a
 * cookie in this browser, which is why the callback must be opened in the same one.
 */
async function continueWithProvider(_prev: AuthState, form: FormData): Promise<AuthState> {
  const provider = String(form.get("provider") ?? "");
  if (!isOAuthProvider(provider)) return { error: "Choose a way to sign in." };
  if (!(await enabledProviders()).includes(provider)) {
    return { error: `${PROVIDER_LABEL[provider]} sign-in is not switched on yet. Use your email address and a password.` };
  }
  const next = safeNext(String(form.get("next") ?? ""));
  const { data, error } = await (await sessionClient()).auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${await origin()}/auth/callback?flow=oauth&next=${encodeURIComponent(next)}`,
      skipBrowserRedirect: true,
    },
  });
  if (error || !data.url) return { error: authErrorMessage(classifyAuthError(error), "signin") };
  redirect(data.url);
}

/**
 * Sets a new password for whoever the recovery link signed in.
 *
 * The session is the authorisation: the link was sent to the address that owns the
 * account and is spent on arrival, so there is no current password to ask for — and
 * asking for one would defeat the point of a reset.
 */
export async function setNewPassword(_prev: AuthState, form: FormData): Promise<AuthState> {
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirmPassword") ?? "");

  if (password.length < PASSWORD_MIN) {
    return { error: `Use a password of at least ${PASSWORD_MIN} characters.` };
  }
  if (password !== confirm) return { error: "The two passwords are not the same." };

  const supabase = await sessionClient();
  const { data: session } = await supabase.auth.getUser();
  if (!session.user) {
    return { error: "That reset link is no longer active. Ask for a new one from the sign-in page." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) return { error: authErrorMessage(classifyAuthError(error), "password") };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await (await sessionClient()).auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
