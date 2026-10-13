import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session.ts";
import { AI_ACT_REFS, AI_ACT_SCENARIOS, GDPR_SCENARIOS, SUITE, solution, solutionMetadata } from "../_components/content.ts";
import { Cards, ClosingCta, Hero, NotCertification, Points, Section, SolutionFrame } from "../_components/solution-ui.tsx";

export const metadata: Metadata = solutionMetadata("eu-ai-act");

/**
 * The EU AI Act page. It names the Act only as the product does: a scenario's `duty_refs`
 * file its evidence under a reference for a reader who already carries that duty. The page
 * never says a duty applies, or that one is met — that is the customer's and their counsel's
 * judgement (docs/COMPETITION.md: any public claim naming the Act needs a lawyer).
 *
 * The counts are eu-support v5's, the suite a new run uses; tests/solutions.test.ts re-counts
 * them from data/suites so a new suite version cannot leave this page stating old figures.
 */
export default async function EuAiActPage() {
  const signedIn = Boolean(await currentUser());
  const page = solution("eu-ai-act");

  return (
    <SolutionFrame signedIn={signedIn} current="eu-ai-act">
      <Hero
        crumb={page.name}
        eyebrow="EU AI Act · AI support agents"
        title={<>Testing evidence for the AI Act duties <span className="text-ink-soft">of a support agent you operate.</span></>}
        lead={
          <>
            Novera tests your AI support agent from the outside, over HTTP, and files each verdict
            under the AI Act and GDPR references it bears on. You get a dated, sealed report of what
            the agent actually did. Which duties apply to you remains a question for your counsel.
          </>
        }
        signedIn={signedIn}
        primary={{ href: "/sign-in?mode=signup", label: "Start with three free runs" }}
        secondary={{ href: "/docs/what-the-report-contains", label: "What a report contains" }}
        facts={[
          [`${AI_ACT_SCENARIOS} of ${SUITE.scenarios}`, `${SUITE.name} scenarios filed under an AI Act reference`],
          [`${GDPR_SCENARIOS} of ${SUITE.scenarios}`, "filed under a GDPR reference"],
          ["SHA-256", "seals each report to its evidence"],
          ["Frankfurt", "where the database runs"],
        ]}
      />

      <Section
        index="01"
        id="refs-heading"
        title="What the suite files under the AI Act"
        lede={<>Every scenario names the references its evidence bears on. Counted from {SUITE.name}, the suite a new run uses.</>}
      >
        <Cards
          columns={4}
          items={[
            {
              tag: "Art. 50(1)",
              title: "Telling people it is an AI",
              body: "Asked outright whether it is a person or a bot, the agent has to say plainly that it is automated — not deflect, not wait to be pressed.",
              note: scenarios(AI_ACT_REFS["EU AI Act Art. 50(1)"]),
            },
            {
              tag: "Art. 13",
              title: "Transparent, accurate information",
              body: "Answers grounded in the sources the agent was given, your policy stated as written, and notice when a decision is automated.",
              note: scenarios(AI_ACT_REFS["EU AI Act Art. 13"]),
            },
            {
              tag: "Art. 14",
              title: "Human oversight",
              body: "Escalation to a person when it is due, authorisation boundaries held under pressure, and approval before an action takes effect.",
              note: scenarios(AI_ACT_REFS["EU AI Act Art. 14"]),
            },
            {
              tag: "Art. 15",
              title: "Accuracy, robustness, cybersecurity",
              body: "Jailbreaks and injected instructions — including ones planted in a retrieved article or a tool's result — honest failure, and refunds neither repeated nor misapplied.",
              note: scenarios(AI_ACT_REFS["EU AI Act Art. 15"]),
            },
          ]}
        />
        <p className="mt-6 max-w-4xl text-sm leading-relaxed text-ink-soft">
          The same suite files {GDPR_SCENARIOS} scenarios under the GDPR — Articles 5, 12, 15 to 22,
          25, 32 and 33: identity before disclosure, access, export, erasure, correction, restriction,
          objection, minimisation and breach escalation. Some scenarios carry both.
        </p>
        <p className="mt-3 max-w-4xl text-sm leading-relaxed text-ink-faint">
          A reference organises evidence for a reader who already carries the duty. It is not a
          finding that the duty applies to your organisation, or that it is met.
        </p>
      </Section>

      <Section
        paper
        index="02"
        id="blackbox-heading"
        title="Tested from outside, against the agent you actually run"
        lede="No SDK and no access to your code or prompts. Novera tests the behaviour your customers meet."
      >
        <Points
          columns={2}
          items={[
            ["An endpoint you nominate.", "Novera sends each scenario to it and records what comes back. It does not modify your agent or sit between it and your customers."],
            ["Authorisation on record.", "You confirm you own the agent or are authorised to test it. The confirmation is copied onto every run and sealed into its report."],
            ["Production kept out of harm's way.", "A scenario that could change real data never runs against an agent marked production; marking one a test target is an audited owner or admin action."],
            ["Actions checked, not taken on trust.", "With a read-only endpoint in your own system, an action the agent claims is confirmed or contradicted there — before any model is asked."],
          ]}
        />
      </Section>

      <Section
        index="03"
        id="record-heading"
        title="A record made to be kept"
        lede="Enforced in the database, not promised in a brochure: the evidence behind a report cannot be quietly improved later."
      >
        <Cards
          items={[
            { title: "Inputs declared before the run", body: "Suite version, scenario order, policy version, agent host, grading plan and pass mark are frozen before the first scenario is sent." },
            { title: "Append-only evidence", body: "A verdict cannot be edited, or deleted short of erasing the whole workspace — by you or by us. A person's disagreement is recorded beside it, with a reason, never instead of it." },
            { title: "Sealed and chained", body: "Each report carries a SHA-256 digest of its content and the hash of the previous report for the same agent. Anyone holding a copy can re-check it." },
            { title: "Unknowns named", body: "Errored, disputed and unexecuted scenarios are counted separately and never as passes. Coverage is stated as three figures, not hidden in one score." },
          ]}
        />
      </Section>

      <NotCertification
        items={[
          ["Not a conformity assessment.", "Novera is not a notified body, and a report is not an approval by one."],
          ["Not legal advice.", "It does not say which obligations apply to your organisation."],
          ["One dated run.", "The scenarios listed, under the configuration recorded, on the date shown."],
          ["Only the suite.", "Not your agent's behaviour on every conversation, nor anything after the report's date."],
        ]}
      />

      <ClosingCta
        signedIn={signedIn}
        title="See what your agent does with these scenarios"
        lede="Connect an HTTP endpoint, write the policy it should keep, and run the suite. Three free runs, and about ten minutes to a first report."
        secondary={{ href: "/docs/data-and-privacy", label: "Where your data goes" }}
      />
    </SolutionFrame>
  );
}

function scenarios(n: number): string {
  return `${n} scenario${n === 1 ? "" : "s"} in ${SUITE.name}`;
}
