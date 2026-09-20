import type { Metadata } from "next";
import Link from "next/link";
import { InboundForm } from "../support/form.tsx";

export const metadata: Metadata = { title: "Try Novera · Novera" };

export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-xl bg-white px-6 py-12 text-slate-900 sm:px-8">
      <Link href="/" className="text-sm text-slate-500 underline-offset-2 hover:underline">
        ← Novera
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Tell us what you are testing</h1>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        You can{" "}
        <Link href="/sign-in" className="font-medium underline underline-offset-2">
          create an account
        </Link>{" "}
        and start immediately — three runs, no card. This form is for when you would rather talk to
        us first, or your setup is unusual enough that you want to know it will work before you
        spend an evening on it.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-slate-600">
        We read these ourselves. There is no automated reply.
      </p>

      <InboundForm
        kind="trial_application"
        messageLabel="What would you point it at?"
        messageHint="What the agent does, who it serves, and what you would want to show a client."
        submitLabel="Send"
      />
    </main>
  );
}
