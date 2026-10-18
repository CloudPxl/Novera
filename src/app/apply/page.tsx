import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/site.ts";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { InboundForm } from "../support/form.tsx";

// Dynamic so the CSP nonce can reach it: Next injects the nonce during server
// rendering, and a page built once at build time has no request to take one from.
export const dynamic = "force-dynamic";

export const metadata: Metadata = pageMetadata({
  title: "Talk to us or ask for a pilot",
  description: "Tell us about the AI support agent you operate, or ask for a pilot for your agency. A person reads every message and replies.",
  path: "/apply",
});

export default async function ApplyPage() {
  const signedIn = Boolean(await currentUser());
  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-xl bg-surface px-6 py-12 text-ink sm:px-8">
        <h1 className="mt-4 text-2xl font-semibold tracking-tight">Talk to us, or ask for a pilot</h1>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          You can{" "}
          <Link href="/sign-in?mode=signup" className="font-medium underline underline-offset-2">
            create an account
          </Link>{" "}
          and start immediately — three runs, no card, shared across every workspace you own. This
          form is for when you would rather talk to us first, when your setup is unusual enough that
          you want to know it will work, or when you want a pilot.
        </p>
        <h2 className="mt-6 text-base font-semibold tracking-tight">Pilots for agencies and teams</h2>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Testing Novera on agents you run for clients, beyond three runs? Ask for a pilot here. If it
          fits, a person replies with a single-use pilot code that adds runs for a fixed period,
          shared across every workspace you own, client workspaces included. Say which agents you
          would test, which suites, and how many client workspaces you have in mind.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          Already have a code?{" "}
          <Link href="/sign-in?mode=signup" className="font-medium underline underline-offset-2">Create an account</Link>,
          then enter it under Settings → Billing, in “Have a pilot code?”.
        </p>
        <p className="mt-3 text-sm leading-relaxed text-ink-soft">
          We read these ourselves. There is no automated reply; a person answers at the address you
          give.
        </p>

        <InboundForm
          kind="trial_application"
          messageLabel="What would you point it at?"
          messageHint="What the agent does, who it serves, and what you would want to show a client. Asking for a pilot? Say so, and how many client workspaces."
          submitLabel="Send"
        />
      </main>
    </>
  );
}
