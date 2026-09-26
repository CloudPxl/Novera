import type { Metadata } from "next";
import Link from "next/link";
import { InboundForm } from "../support/form.tsx";

// Dynamic so the CSP nonce can reach it: Next injects the nonce during server
// rendering, and a page built once at build time has no request to take one from.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Try Novera · Novera" };

export default function ApplyPage() {
  return (
    <main className="mx-auto w-full max-w-xl bg-surface px-6 py-12 text-ink sm:px-8">
      <Link href="/" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Novera
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Tell us what you are testing</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        You can{" "}
        <Link href="/sign-in" className="font-medium underline underline-offset-2">
          create an account
        </Link>{" "}
        and start immediately — three runs, no card. This form is for when you would rather talk to
        us first, or your setup is unusual enough that you want to know it will work before you
        spend an evening on it.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
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
