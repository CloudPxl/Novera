import Link from "next/link";
import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { currentUser, INVITE_COOKIE } from "@/lib/auth/session.ts";
import { SignInForm, type Mode } from "./form.tsx";
import { problemMessage } from "../auth/confirm/problems.ts";
import { enabledProviders } from "@/lib/auth/providers.ts";
import { safeNext } from "@/lib/auth/redirects.ts";

export const metadata: Metadata = { title: "Sign in · Novera" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string; next?: string; mode?: string }>;
}) {
  const query = await searchParams;
  // An invitation held in this browser (src/lib/workflow/identity.ts) is where a person goes
  // after signing in when nothing else was asked for — also after a confirmation opened in
  // another browser or a password reset, which lose the query string on the way.
  const held = (await cookies()).get(INVITE_COOKIE)?.value;
  const next = safeNext(query.next ?? (held ? `/invite/${held}` : undefined));
  if (await currentUser()) redirect(next);
  // Mapped from a code this application defined, never rendered from the query string:
  // a link someone was sent must not be able to put its own sentence inside our alert.
  const problem = problemMessage(query.problem);
  // A spent or broken confirmation link opens on "send a new one", which is what the alert says to do.
  const mode: Mode = query.problem === "link_spent" || query.problem === "link_invalid"
    ? "resend"
    : query.problem === "reset_expired" ? "reset"
    : query.mode === "signup" || query.mode === "reset" ? query.mode : "signin";
  const providers = await enabledProviders();

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint"><Link href="/" className="rounded-control hover:text-ink">Novera</Link></p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Evidence that your agent behaves as your policies require
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Run a versioned scenario suite against an agent you operate, and produce a dated report
        you can hand to a client.
      </p>
      {problem && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-warning-border bg-warning-surface px-3 py-2 text-sm leading-relaxed text-warning-text"
        >
          {problem}
        </p>
      )}
      <SignInForm providers={providers} next={next} initialMode={mode} />
    </main>
  );
}
