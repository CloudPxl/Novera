import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { currentUser } from "@/lib/auth/session.ts";
import { SignInForm } from "./form.tsx";

export const metadata: Metadata = { title: "Sign in · Novera" };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ problem?: string }>;
}) {
  if (await currentUser()) redirect("/dashboard");
  const { problem } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center bg-white px-6 text-slate-900">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Novera</p>
      <h1 className="mt-3 text-2xl font-semibold tracking-tight">
        Evidence that your agent behaves as your policies require
      </h1>
      <p className="mt-2 text-sm leading-relaxed text-slate-600">
        Run a versioned scenario suite against an agent you operate, and produce a dated report
        you can hand to a client.
      </p>
      {problem && (
        <p
          role="alert"
          className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-relaxed text-amber-900"
        >
          {problem}
        </p>
      )}
      <SignInForm />
    </main>
  );
}
