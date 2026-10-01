import type { Metadata } from "next";
import Link from "next/link";
import { ButtonLink } from "@/components/ui/button-link.tsx";
import { currentUser } from "@/lib/auth/session.ts";
import { Reveal } from "@/components/ui/reveal.tsx";
import { Card, Badge } from "@/components/ui/primitives.tsx";
import { SampleReport } from "./sample-report.tsx";

export const metadata: Metadata = {
  title: "Novera — evidence your AI agent behaves as your policies require",
  description:
    "Run a versioned scenario suite against an AI support agent you operate and produce a dated, hash-sealed report you can hand to a client.",
};

/**
 * The public front door.
 *
 * Deliberately claims nothing the product does not already do. Every number and
 * behaviour named here is one the running code produces — the suite size, the
 * append-only storage, the two-model verdict, the sealed hash. There is no pricing on
 * this page: it has not been decided, and inventing one to fill a section would be
 * the first dishonest thing on the site.
 */
export default async function Home() {
  // The home page for everyone. A signed-in visitor used to be bounced to the dashboard,
  // which left no way back to "what is this" and dropped new users into the deep end.
  const signedIn = Boolean(await currentUser());

  return (
    <div className="bg-surface text-ink">
      <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-ink-faint">Novera</p>
        <nav aria-label="Primary" className="flex items-center gap-4 text-sm">
          <Link href="/guide" className="font-medium text-ink-soft underline-offset-2 hover:underline">
            How it works
          </Link>
          <ButtonLink href={signedIn ? "/dashboard" : "/sign-in"} variant="secondary" size="sm">
            {signedIn ? "Open your dashboard" : "Sign in"}
          </ButtonLink>
        </nav>
      </header>

      <main>
        <section className="mx-auto w-full max-w-5xl px-6 pb-20 pt-10 sm:px-8 sm:pt-16">
          <Reveal>
            <p className="text-sm font-medium text-ink-faint">
              For agencies and teams who ship AI support agents to clients
            </p>
            <h1 className="mt-4 max-w-3xl text-4xl font-semibold leading-[1.1] tracking-tight sm:text-5xl">
              When your client asks how the agent behaves, send them{" "}
              <span className="text-ink-soft">the document</span>
              .
            </h1>
            <p className="mt-5 max-w-2xl text-lg leading-relaxed text-ink-soft">
              Novera runs a versioned scenario suite against an agent you operate, grades every
              answer against your own written policy, and produces a dated report you can hand over.
              Not a dashboard you screenshot. A document that stands on its own.
            </p>
          </Reveal>

          <Reveal delay={80}>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <ButtonLink href={signedIn ? "/dashboard" : "/sign-in"}>
                {signedIn ? "Open your dashboard" : "Start with three free runs"}
              </ButtonLink>
              <Link href="/guide" className="text-sm font-medium text-ink-soft underline underline-offset-2">
                See the steps first
              </Link>
              <span className="text-sm text-ink-faint">
                No card. Bring your own model key to keep going.
              </span>
            </div>
          </Reveal>

          <Reveal delay={160} className="mt-14">
            <SampleReport />
          </Reveal>
        </section>

        <section className="border-y border-line bg-ground/60">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-8">
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Manual spot-checking covers a fraction of what your agent does
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
                You changed the prompt on Tuesday. Something that used to work stopped working, and
                nobody noticed until the client did. The honest answer to &ldquo;is it still
                behaving?&rdquo; is usually &ldquo;we think so&rdquo; — which is not an answer you
                want to give the people paying you.
              </p>
            </Reveal>

            <div className="mt-10 grid gap-4 sm:grid-cols-3">
              {[
                {
                  title: "Forty-nine scenarios, every time",
                  body: "Identity checks, deletion requests, data exports, refund limits, prompt extraction, escalation, invented capabilities, jailbreaks, encoded and injected instructions. A suite version is fixed once published, so two reports are comparable.",
                },
                {
                  title: "Graded against your policy",
                  body: "Not a generic benchmark. You write the policy your agent is supposed to follow, we freeze that version, and every verdict is judged against that text.",
                },
                {
                  title: "A rerun shows what your change did",
                  body: "Fixed, still failing, and — the one everybody skips — newly broken. A policy edit that quietly makes the agent worse has nowhere to hide.",
                },
              ].map((item, i) => (
                <Reveal key={item.title} delay={i * 70}>
                  <Card className="h-full p-5">
                    <h3 className="text-base font-semibold">{item.title}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
                  </Card>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-8">
          <Reveal>
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
              A report is only worth sending if it cannot be quietly improved
            </h2>
            <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
              The reason to hand this to a client is that neither of you has to take our word for
              it. These are properties of the system, not promises in a brochure.
            </p>
          </Reveal>

          <div className="mt-10 grid gap-4 sm:grid-cols-2">
            {[
              {
                badge: "Append-only",
                title: "A verdict cannot be edited after the fact",
                body: "Results, policy versions and reports are append-only in the database itself. A failing case cannot be deleted to flatter a score — not by you, not by us, not with the administrative key.",
              },
              {
                badge: "Two models",
                title: "A verdict is a finding, not an opinion",
                body: "On our key, every scenario is graded by two models from different vendors, with a third to settle a disagreement. When they cannot agree, the case is reported as unresolved and left out of the score rather than guessed. On your own key there is one vendor, so each verdict is labelled with how corroborated it actually was.",
              },
              {
                badge: "Sealed",
                title: "The document is hashed to the run behind it",
                body: "Each report carries a SHA-256 digest of its own evidence. Change any figure or finding and the digest no longer matches the stored run.",
              },
              {
                badge: "Never a pass",
                title: "A case that did not run is never counted as passing",
                body: "Timeouts, provider failures and unreadable verdicts are counted separately and named in the report. Coverage is stated, not implied by a percentage.",
              },
            ].map((item, i) => (
              <Reveal key={item.title} delay={i * 70}>
                <Card className="h-full p-5" interactive>
                  <Badge tone="neutral">{item.badge}</Badge>
                  <h3 className="mt-3 text-base font-semibold">{item.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-soft">{item.body}</p>
                </Card>
              </Reveal>
            ))}
          </div>
        </section>

        <section className="border-y border-line bg-ground/60">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-8">
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Four steps, about ten minutes
              </h2>
            </Reveal>
            <ol className="mt-10 space-y-4">
              {[
                {
                  step: "Connect the agent",
                  body: "Point Novera at an HTTP endpoint you operate and confirm you are authorised to test it. We send one harmless request first and save the reply as a receipt, so you can see what we are talking to before a full run.",
                },
                {
                  step: "Write the policy",
                  body: "The rules the agent is meant to follow, in plain sentences. Saving creates a version; versions are never edited, so a report always names exactly what was tested against.",
                },
                {
                  step: "Run the suite",
                  body: "Every scenario in the suite goes to your agent and comes back graded, streaming in as they finish, each showing the verdict, the reasoning, and which models decided it.",
                },
                {
                  step: "Send the report",
                  body: "One link, expiring and revocable, printable to PDF. It carries the score, the coverage, the findings, the limitations, and the hash — and never your policy text, your keys, or the raw transcript.",
                },
              ].map((item, i) => (
                <Reveal key={item.step} delay={i * 60} as="li" className="flex gap-4">
                    <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-on-ink tabular-nums">
                      {i + 1}
                    </span>
                    <div>
                      <h3 className="text-base font-semibold">{item.step}</h3>
                      <p className="mt-1 max-w-2xl text-sm leading-relaxed text-ink-soft">
                        {item.body}
                      </p>
                    </div>
                </Reveal>
              ))}
            </ol>
          </div>
        </section>

        <section className="mx-auto w-full max-w-5xl px-6 py-20 sm:px-8">
          <Reveal>
            <Card className="p-8 sm:p-10">
              <h2 className="text-2xl font-semibold tracking-tight">
                What Novera is not
              </h2>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
                Novera is evidence of testing. It is not a certification, and it does not tell you
                which obligations apply to your organisation. Every report says so in its own
                limitations block, because a document that overstates itself is worth less than one
                that does not — especially to the person you are handing it to.
              </p>
              <p className="mt-4 max-w-2xl text-base leading-relaxed text-ink-soft">
                The database runs in Frankfurt and your model keys are encrypted before storage,
                decrypted only on the server. Grading is a different question and we would rather
                you heard it here: your agent&apos;s answers are sent to the model providers that
                grade them, which today include providers outside the EU. Each report names the
                models that graded each scenario, and{" "}
                <Link href="/docs/data-and-privacy" className="underline underline-offset-2 hover:text-ink">
                  the documentation says exactly what goes where
                </Link>
                .
              </p>
            </Card>
          </Reveal>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto w-full max-w-5xl px-6 py-20 text-center sm:px-8">
            <Reveal>
              <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                Run it against your own agent
              </h2>
              <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-ink-soft">
                Three runs on us, graded on our key. After that, connect your own model key and keep
                going — there is nothing to pay us.
              </p>
              <div className="mt-8 flex justify-center">
                <ButtonLink href="/sign-in">Create an account</ButtonLink>
              </div>
            </Reveal>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex w-full max-w-5xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-ink-faint sm:px-8">
          <p>Novera · Agent conformity evidence</p>
          <nav className="flex flex-wrap items-center gap-4">
            <Link href="/docs" className="underline-offset-2 hover:text-ink hover:underline">
              Documentation
            </Link>
            <Link href="/support" className="underline-offset-2 hover:text-ink hover:underline">
              Support
            </Link>
            <Link href="/apply" className="underline-offset-2 hover:text-ink hover:underline">
              Talk to us first
            </Link>
          </nav>
          <p>Data resident in the EU (Frankfurt)</p>
        </div>
      </footer>
    </div>
  );
}
