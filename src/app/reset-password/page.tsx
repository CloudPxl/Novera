import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session.ts";
import { NewPasswordForm } from "./form.tsx";

export const metadata: Metadata = { title: "Set a new password · Novera" };
export const dynamic = "force-dynamic";

/**
 * Where a password reset link lands.
 *
 * The recovery token is spent by `/auth/confirm`, which creates a session — so the
 * session *is* the authorisation here, and there is no current password to ask for.
 * Asking for one would defeat the only case this page exists to serve.
 *
 * Reachable while signed in by any route, which is deliberate: it doubles as the
 * change-password page, and a product that holds customers' encrypted model keys
 * should not require losing access in order to rotate the password guarding them.
 */
export default async function ResetPasswordPage() {
  const user = await currentUser();
  if (!user) redirect("/sign-in?problem=reset_expired");

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
