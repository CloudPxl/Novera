import type { Metadata } from "next";
import Link from "next/link";
import { SiteHeader } from "@/app/_home/site-header.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { GUIDE_STEPS, GUIDE_TERMS } from "@/lib/guide/content.ts";

export const metadata: Metadata = {
  title: "How to use Novera · Guide",
  description: "Step by step: connect an agent, write its policy, run the suite, read the results and share the report.",
};
export const dynamic = "force-dynamic";

export default async function GuidePage() {
  const signedIn = Boolean(await currentUser());

  return (
    <>
      <SiteHeader signedIn={signedIn} />
      <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-6 py-10 text-ink sm:px-8">

        <h1 className="text-3xl font-semibold tracking-tight">How to use Novera</h1>
        <p className="mt-3 text-lg leading-relaxed text-ink-soft">
          Seven steps from a connected agent to a report you can hand to a client. The first run
          usually takes about ten minutes, most of it writing the policy.
        </p>

        <ol className="mt-10 space-y-6">
          {GUIDE_STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4">
              <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink text-sm font-semibold text-on-ink">
                {i + 1}
              </span>
              <div>
                <h2 className="text-lg font-semibold tracking-tight">{step.title}</h2>
                <p className="mt-1 leading-relaxed text-ink-soft">{step.body}</p>
                <p className="mt-1.5 text-sm text-ink-faint">
                  Where:{" "}
                  {signedIn ? (
                    <Link href={step.target === "connect" ? "/agents/new" : "/dashboard"} className="underline underline-offset-2 hover:text-ink">{step.where}</Link>
                  ) : (
                    step.where
                  )}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <h2 className="mt-14 text-2xl font-semibold tracking-tight">Words you will see</h2>
        <dl className="mt-5 divide-y divide-line border-y border-line">
          {GUIDE_TERMS.map(([term, meaning]) => (
            <div key={term} className="grid gap-1 py-3 sm:grid-cols-[12rem_1fr] sm:gap-4">
              <dt className="font-medium">{term}</dt>
              <dd className="leading-relaxed text-ink-soft">{meaning}</dd>
            </div>
          ))}
        </dl>

        <p className="mt-10 text-sm leading-relaxed text-ink-faint">
          More detail in the <Link href="/docs" className="underline underline-offset-2">documentation</Link>.
          Novera is evidence of testing, not a legal certification.
        </p>
      </main>
    </>
  );
}
