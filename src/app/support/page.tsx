import type { Metadata } from "next";
import Link from "next/link";
import { InboundForm } from "./form.tsx";

// Dynamic so the CSP nonce can reach it: Next injects the nonce during server
// rendering, and a page built once at build time has no request to take one from.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Support · Novera" };

export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-xl bg-surface px-6 py-12 text-ink sm:px-8">
      <Link href="/" className="text-sm text-ink-faint underline-offset-2 hover:underline">
        ← Novera
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">Ask us something</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Have a look at the{" "}
        <Link href="/docs" className="font-medium underline underline-offset-2">
          documentation
        </Link>{" "}
        first — it is short. If it does not cover your question, this reaches us directly.
      </p>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        A model drafts a first answer from those same documentation pages, and a person reads and
        approves it before anything is sent to you. Questions about money, your personal data,
        contracts or security skip the draft entirely and go straight to a person.
      </p>

      <InboundForm
        kind="support"
        messageLabel="Your question"
        messageHint="The more specific, the better an answer you get."
        submitLabel="Send question"
      />
    </main>
  );
}
