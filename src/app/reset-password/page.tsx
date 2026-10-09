import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { openRecovery, RECOVERY_COOKIE, recoverySecret } from "@/lib/auth/recovery.ts";
import { currentUser } from "@/lib/auth/session.ts";
import { NewPasswordForm } from "./form.tsx";

export const metadata: Metadata = { title: "Set a new password · Novera" };
export const dynamic = "force-dynamic";

/**
 * Where a password reset link lands.
 *
 * The recovery link creates a session and, beside it, a recovery context
 * (src/lib/auth/recovery.ts): the authorisation is the pair. A session alone used to be
 * enough, so any signed-in browser could set a new password here without the current one
 * (app-wide audit, 2026-10-08). Changing a password while signed in is Settings → Sign-in
 * and security, which asks for the current one.
 */
export default async function ResetPasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?problem=reset_expired");
  const recovery = openRecovery((await cookies()).get(RECOVERY_COOKIE)?.value, user.id, recoverySecret());
  if (!recovery) redirect("/sign-in?problem=reset_expired");

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint"><Link href="/" className="rounded-control hover:text-ink">Novera</Link></p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">Set a new password</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        For {user.email}. Choosing a new password signs out anywhere else this account is
        signed in.
      </p>
      <NewPasswordForm />
    </main>
  );
}
