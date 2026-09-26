import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session.ts";
import { SignInForm } from "./form.tsx";
import { problemMessage } from "../auth/confirm/problems.ts";

export const metadata: Metadata = { title: "Sign in · Novera" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  if (await currentUser()) redirect("/dashboard");
  // Mapped from a code this application defined, never rendered from the query string:
  // a link someone was sent must not be able to put its own sentence inside our alert.
  const problem = problemMessage((await searchParams).problem);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-surface px-6 text-ink">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">Novera</p>
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
      <SignInForm />
    </main>
  );
}
