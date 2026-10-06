"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient, type UserIdentity, type User } from "@supabase/supabase-js";
import { requireUser } from "@/lib/auth/session.ts";
import { sessionClient } from "@/lib/supabase/server.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { authErrorMessage, classifyAuthError } from "@/lib/auth/errors.ts";
import { appOrigin, isOAuthProvider, PROVIDER_LABEL } from "@/lib/auth/redirects.ts";
import { enabledProviders } from "@/lib/auth/providers.ts";
import { rateLimit } from "@/lib/support/rate-limit.ts";
import { fingerprint, refusalMessage, type Limit } from "@/lib/support/throttle.ts";
import type { FormState } from "@/lib/workflow/actions.ts";

/**
 * A person's ways in: connected Google or GitHub accounts, a password, and their sessions.
 *
 * Everything here is about the person, not a workspace, so the audit line carries no
 * workspace (0054 allows that; it is read by the person themself). No provider token is ever
 * read or shown — the identity rows say which provider and which address, nothing more.
 *
 * Linking is Supabase's manual identity linking: the person is already signed in, proves
 * the other account at the provider, and the provider's identity joins *this* user id. No
 * account is merged into another, and no workspace moves.
 */

const PASSWORD_MIN = 8;
const CURRENT_PASSWORD_LIMIT: Limit = { max: 5, windowSeconds: 60 * 60 };

/**
 * Whether the person can sign in with a password today. An email sign-up has an `email`
 * identity; someone who arrived through Google and then set a password has none, so that
 * fact is kept in `app_metadata`, which only the service role can write.
 */
function hasPassword(user: User, identities: UserIdentity[]): boolean {
  return identities.some((i) => i.provider === "email") || user.app_metadata?.novera_password === true;
}

async function identitiesOf(): Promise<{ user: User; identities: UserIdentity[] } | { error: string }> {
  const supabase = await sessionClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return { error: "Your session has ended. Sign in again." };
  const { data, error } = await supabase.auth.getUserIdentities();
  if (error) return { error: "Your sign-in methods could not be read. Try again in a moment." };
  return { user: auth.user, identities: data?.identities ?? [] };
}

export async function linkProviderAction(_prev: FormState, form: FormData): Promise<FormState> {
  await requireUser();
  const provider = String(form.get("provider") ?? "");
  if (!isOAuthProvider(provider)) return { error: "Choose Google or GitHub." };
  if (!(await enabledProviders()).includes(provider)) return { error: `${PROVIDER_LABEL[provider]} sign-in is not switched on for this service yet.` };

  const origin = appOrigin((await headers()).get("origin"));
  const { data, error } = await (await sessionClient()).auth.linkIdentity({
    provider,
    options: { redirectTo: `${origin}/auth/callback?flow=link&provider=${provider}`, skipBrowserRedirect: true },
  });
  if (error || !data?.url) return { error: authErrorMessage(classifyAuthError(error), "link") };
  redirect(data.url);
}

export async function unlinkProviderAction(_prev: FormState, form: FormData): Promise<FormState> {
  const found = await identitiesOf();
  if ("error" in found) return { error: found.error };
  const { user, identities } = found;
  const target = identities.find((i) => i.identity_id === String(form.get("identityId") ?? ""));
  if (!target) return { error: "That sign-in method is not connected to your account." };

  // Never the last way in. What remains must be a provider, or a password that exists.
  const remaining = identities.filter((i) => i.identity_id !== target.identity_id);
  const usable = remaining.some((i) => i.provider !== "email") || (remaining.some((i) => i.provider === "email") && hasPassword(user, remaining));
  if (!usable) return { error: authErrorMessage("single_identity", "link") };

  const { error } = await (await sessionClient()).auth.unlinkIdentity(target);
  if (error) return { error: authErrorMessage(classifyAuthError(error), "link") };

  await recordAudit(serviceClient(), { workspaceId: null, actorId: user.id, subjectUserId: user.id, action: "identity.unlinked", detail: { provider: target.provider } });
  revalidatePath("/settings/account");
  // The page says so, not this form: the row holding this form is gone once the page re-renders,
  // and its message went with it (found by the walk, 2026-10-06).
  redirect(`/settings/account?unlinked=${encodeURIComponent(target.provider)}`);
}

/**
 * Sets a first password, or changes one — asking for the current password when there is one.
 *
 * The current password is checked by signing in with it on a separate, cookie-less client
 * whose session is ended at once; the person's own session is untouched until the change.
 * Counted per person, so a borrowed laptop cannot be used to guess it.
 */
export async function passwordAction(_prev: FormState, form: FormData): Promise<FormState> {
  const found = await identitiesOf();
  if ("error" in found) return { error: found.error };
  const { user, identities } = found;
  const password = String(form.get("password") ?? "");
  const confirm = String(form.get("confirmPassword") ?? "");
  if (password.length < PASSWORD_MIN) return { error: `Use a password of at least ${PASSWORD_MIN} characters.` };
  if (password.length > 200) return { error: "That is longer than a password field accepts." };
  if (password !== confirm) return { error: "The two new passwords are not the same." };
  if (!user.email) return { error: "Your account has no email address to sign in with, so a password cannot be added." };

  const existing = hasPassword(user, identities);
  if (existing) {
    const current = String(form.get("currentPassword") ?? "");
    if (!current) return { error: "Enter your current password." };
    const who = fingerprint(["password-check", user.id]);
    const limit = await rateLimit(who, CURRENT_PASSWORD_LIMIT, { peek: true, onError: "refuse" });
    if (!limit.allowed) return { error: refusalMessage(limit.retryAfterMinutes) };
    const probe = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    });
    const { data: checked, error: wrong } = await probe.auth.signInWithPassword({ email: user.email, password: current });
    if (wrong || checked.user?.id !== user.id) {
      await rateLimit(who, CURRENT_PASSWORD_LIMIT, { onError: "refuse" });
      return { error: "That is not your current password." };
    }
    await probe.auth.signOut({ scope: "local" });
  }

  const { error } = await (await sessionClient()).auth.updateUser({ password });
  if (error) return { error: authErrorMessage(classifyAuthError(error), "password") };

  const admin = serviceClient();
  if (!existing) {
    const { error: markError } = await admin.auth.admin.updateUserById(user.id, { app_metadata: { ...user.app_metadata, novera_password: true } });
    if (markError) console.error(`[auth] password set but not recorded in app_metadata (${markError.status ?? "?"})`);
  }
  await recordAudit(admin, { workspaceId: null, actorId: user.id, subjectUserId: user.id, action: existing ? "account.password_changed" : "account.password_set" });
  revalidatePath("/settings/account");
  return { notice: existing ? "Password changed." : `Password added. You can now also sign in with ${user.email} and this password.` };
}

/** Ends every session this account has — this browser's included — and records that it did. */
export async function signOutEverywhereAction(_prev: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  if (form.get("confirm") !== "on") return { error: "Tick the box to confirm." };
  await recordAudit(serviceClient(), { workspaceId: null, actorId: user.id, subjectUserId: user.id, action: "account.signed_out_everywhere" });
  const { error } = await (await sessionClient()).auth.signOut({ scope: "global" });
  if (error) return { error: "Sessions could not be ended just now. Try again in a moment." };
  revalidatePath("/", "layout");
  redirect("/sign-in?problem=signed_out_everywhere");
}
