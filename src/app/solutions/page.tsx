import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session.ts";
import { SOLUTIONS, SUITE, solutionsIndexMetadata } from "./_components/content.ts";
import { ClosingCta, Hero, NotCertification, SolutionFrame } from "./_components/solution-ui.tsx";

export const metadata: Metadata = solutionsIndexMetadata();

/** The three solution pages, one card each. */
export default async function SolutionsIndex() {
  const signedIn = Boolean(await currentUser());

  return (
    <SolutionFrame signedIn={signedIn}>
      <Hero
        eyebrow="Who reads the report"
        title={<>One product, <span className="text-ink-soft">three reasons to run it.</span></>}
        lead={
          <>
            Novera runs a versioned scenario suite against an AI support agent you operate and seals
            a dated report of what it did. Who reads that report differs: your counsel, your
            pipeline, or your client.
          </>
        }
        signedIn={signedIn}
        primary={{ href: "/sign-in?mode=signup", label: "Start with three free runs" }}
        secondary={{ href: "/docs/what-novera-does", label: "What Novera does" }}
        facts={[
          [String(SUITE.scenarios), `scenarios in every run of ${SUITE.name}`],
          ["2 vendors", "grade each verdict on Novera's keys"],
          ["SHA-256", "seals every report to its evidence"],
          ["Frankfurt", "where the database runs"],
        ]}
      />

      <section aria-labelledby="list-heading" className="border-b border-line">
        <div className="wrap-wide py-16 sm:py-20">
          <h2 id="list-heading" className="type-section">Where Novera fits</h2>
          <ul className="mt-10 grid gap-4 lg:grid-cols-3">
            {SOLUTIONS.filter((s) => s.kind === "audience").map((s, i) => (
              <li key={s.slug}>
                <Link href={s.path} className="novera-lift group flex h-full flex-col rounded-panel border border-line bg-surface p-6 shadow-card transition-[transform,box-shadow,border-color] duration-150">
                  <span className="type-eyebrow text-ink-faint">{String(i + 1).padStart(2, "0")}</span>
                  <span className="mt-3 text-lg font-semibold group-hover:underline group-hover:underline-offset-2">{s.name}</span>
                  <span className="mt-2 text-sm leading-relaxed text-ink-soft">{s.summary}</span>
                  <span aria-hidden className="mt-auto pt-5 text-sm font-medium text-ink">Read more →</span>
                </Link>
              </li>
            ))}
          </ul>
          <h2 id="reference-heading" className="mt-14 type-eyebrow text-ink-faint">Reference</h2>
          <ul aria-labelledby="reference-heading" className="mt-5 grid gap-4">
            {SOLUTIONS.filter((s) => s.kind === "reference").map((s) => (
              <li key={s.slug}>
                <Link href={s.path} className="novera-lift group flex flex-col gap-x-10 gap-y-2 rounded-panel border border-line bg-surface p-6 shadow-card transition-[transform,box-shadow,border-color] duration-150 md:flex-row md:items-center md:justify-between">
                  <span>
                    <span className="block text-lg font-semibold group-hover:underline group-hover:underline-offset-2">{s.name}</span>
                    <span className="mt-2 block text-sm leading-relaxed text-ink-soft">{s.summary}</span>
                  </span>
                  <span aria-hidden className="shrink-0 text-sm font-medium text-ink">Open the matrix →</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <NotCertification
        items={[
          ["Not a certification.", "Novera is evidence of testing."],
          ["Not legal advice.", "It does not say which obligations apply to your organisation."],
          ["One dated run.", "One suite version against one policy version."],
          ["Only the suite.", "Not your agent's behaviour on every conversation."],
        ]}
      />

      <ClosingCta
        signedIn={signedIn}
        title="Run it against your own agent"
        lede="Three free runs, graded on Novera's keys or your own. About ten minutes to a first report."
        secondary={{ href: "/guide", label: "Read the step-by-step guide" }}
      />
    </SolutionFrame>
  );
}
