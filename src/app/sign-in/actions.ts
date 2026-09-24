"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sessionClient } from "@/lib/supabase/server.ts";
import { rateLimit } from "@/lib/support/rate-limit.ts";
import { fingerprint, refusalMessage, type Limit } from "@/lib/support/throttle.ts";
import { callerAddress } from "@/lib/support/rate-limit.ts";

export interface AuthState {
  error?: string;
  notice?: string;
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
const RESET_LIMIT: Limit = { max: 3, windowSeconds: 60 * 60 };

function readCredentials(
  form: FormData,
  { enforceMinimum }: { enforceMinimum: boolean },
): { email: string; password: string } | string {
  const email = String(form.get("email") ?? "").trim();
  const password = String(form.get("password") ?? "");
  if (!email || !password) return "Enter your email address and a password.";
  // Only when a password is being set. Applying it on sign-in would lock out an
  // account created before the minimum existed, by rejecting the correct password.
  if (enforceMinimum && password.length < PASSWORD_MIN) {
    return `Use a password of at least ${PASSWORD_MIN} characters.`;
  }
  if (password.length > 200) return "That is longer than a password field accepts.";
  return { email, password };
}

/**
 * One action for both modes, branching on a hidden field.
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
  return signIn(prev, form);
}

async function signIn(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form, { enforceMinimum: false });
  if (typeof credentials === "string") return { error: credentials };

  const who = fingerprint(["signin", credentials.email, await callerAddress()]);
  const limit = await rateLimit(who, SIGN_IN_LIMIT, { peek: true });
  if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };

  const { error } = await (await sessionClient()).auth.signInWithPassword(credentials);

  // Supabase does not distinguish a wrong password from an unknown address, and
  // neither do we — saying which would confirm whether an account exists.
  if (error) {
    // Counted only on failure: a person who mistypes once and then signs in has spent
    // nothing, and the limit is about guessing rather than about signing in.
    await rateLimit(who, SIGN_IN_LIMIT);
    return { error: "That email address and password do not match an account." };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * The neutral answer to "did that address already have an account".
 *
 * Supabase returns a session-less success for an existing address when confirmations
 * are on, which is the behaviour we want. But it can also return a plain error saying
 * "User already registered" — and that message used to be passed straight through,
 * undoing the non-disclosure three lines below it.
 */
const NEUTRAL_SIGNUP =
  "If that address can be registered, a confirmation email is on its way. If you already have an account, sign in instead.";

async function signUp(_prev: AuthState, form: FormData): Promise<AuthState> {
  const credentials = readCredentials(form, { enforceMinimum: true });
  if (typeof credentials === "string") return { error: credentials };

  const { data, error } = await (await sessionClient()).auth.signUp(credentials);

  if (error) {
    if (/registered|already exists|already in use/i.test(error.message)) {
      return { notice: NEUTRAL_SIGNUP };
    }
    // Everything else is about the password or about signups being closed, and the
    // person can act on it.
    return { error: error.message };
  }

  if (!data.session) return { notice: NEUTRAL_SIGNUP };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Sends a password reset link.
 *
 * Answers the same way whether or not the address has an account, for the same reason
 * sign-up does. Before this existed, a person who forgot their password had no path at
 * all except writing to support.
 */
async function requestPasswordReset(_prev: AuthState, form: FormData): Promise<AuthState> {
  const email = String(form.get("email") ?? "").trim();
  if (!email) return { error: "Enter the email address you signed up with." };

  const limit = await rateLimit(fingerprint(["reset", email, await callerAddress()]), RESET_LIMIT);
  if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };

  const origin = (await headers()).get("origin") ?? process.env.NEXT_PUBLIC_SITE_URL ?? "";
  await (await sessionClient()).auth.resetPasswordForEmail(email, {
    redirectTo: origin ? `${origin}/auth/confirm` : undefined,
  });

  return {
    notice:
      "If that address has an account, a reset link is on its way. The link signs you in once and asks for a new password; it expires, and using it ends any other session.",
  };
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
  if (error) return { error: error.message };

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signOut(): Promise<void> {
  await (await sessionClient()).auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}
