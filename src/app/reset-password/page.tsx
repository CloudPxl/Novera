import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { readRecovery, RECOVERY_COOKIE, recoverySecret } from "@/lib/auth/recovery.ts";
import { serviceClient } from "@/lib/supabase/service.ts";
import { currentUser } from "@/lib/auth/session.ts";
import { NewPasswordForm } from "./form.tsx";

export const metadata: Metadata = { title: "Set a new password · Novera" };
export const dynamic = "force-dynamic";

/**
 * Where a password reset link lands.
 *
 * The authorisation is a recovery context (src/lib/auth/recovery.ts). A bound one — the link
 * this browser asked for, spent with its PKCE verifier — sits beside the session the link
 * created, and the pair is required. An unbound one (a bare token_hash link) never signed
 * this browser in: the page names the account from the context alone, and the action sets the
 * password with the session sealed inside it. A session alone used to be
 * enough, so any signed-in browser could set a new password here without the current one
 * (app-wide audit, 2026-10-08). Changing a password while signed in is Settings → Sign-in
 * and security, which asks for the current one.
 */
export default async function ResetPasswordPage() {
  const recovery = readRecovery((await cookies()).get(RECOVERY_COOKIE)?.value, recoverySecret());
  if (!recovery) redirect("/sign-in?problem=reset_expired");
  let email: string | undefined;
  if (recovery.bound) {
    const user = await currentUser();
    if (!user || user.id !== recovery.userId) redirect("/sign-in?problem=reset_expired");
    email = user.email;
  } else {
    const { data } = await serviceClient().auth.admin.getUserById(recovery.userId);
    if (!data.user) redirect("/sign-in?problem=reset_expired");
    email = data.user.email;
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint"><Link href="/" className="rounded-control hover:text-ink">Novera</Link></p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        For {email}. Choosing a new password signs out anywhere else this account is
        signed in.
        {!recovery.bound && " This link does not sign this browser in: sign in with the new password afterwards."}
      </p>
      <NewPasswordForm />
    </main>
  );
}
