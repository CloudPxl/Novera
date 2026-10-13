import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session.ts";
import { SUITE, solution, solutionMetadata } from "../_components/content.ts";
import { Cards, ClosingCta, ExitCodes, Hero, NotCertification, Points, Section, SolutionFrame, Stages } from "../_components/solution-ui.tsx";

export const metadata: Metadata = solutionMetadata("black-box-testing");

/**
 * Black-box behavioural testing. Every stage named here is one the runner performs today, in
 * this order (src/lib/runner, src/lib/judge): rules, then the read-back, then models — and the
 * consensus is described as it is on each key, since a workspace key grades on its own
 * provider and the report says so.
 */
export default async function BlackBoxTestingPage() {
  const signedIn = Boolean(await currentUser());
  const page = solution("black-box-testing");

  return (
    <SolutionFrame signedIn={signedIn} current="black-box-testing">
      <Hero
        crumb={page.name}
        eyebrow="Black-box testing · over HTTP"
        title={<>Black-box testing for AI support agents, <span className="text-ink-soft">from the outside in.</span></>}
        lead={
          <>
            Novera sends a versioned scenario suite to your agent&apos;s HTTP endpoint, checks every
            reply with rules, your own system of record and two independent models, and seals the
            result into a report a person can read and a pipeline can act on.
          </>
        }
        signedIn={signedIn}
        primary={{ href: "/sign-in?mode=signup", label: "Start with three free runs" }}
        secondary={{ href: "/docs/how-a-run-works", label: "How a run works" }}
        facts={[
          [String(SUITE.scenarios), `scenarios in every run of ${SUITE.name}`],
          ["3 stages", "rules, read-back, then models"],
          ["5 exit codes", "pass, fail, incomplete, config, infra"],
          ["SHA-256", "seals every report to its evidence"],
        ]}
      />

      <Section
        index="01"
        id="connect-heading"
        title="Connect an endpoint, not a codebase"
        lede="No SDK, no agent framework required. If it answers HTTP, it can be tested."
      >
        <Cards
          items={[
            { title: "A request template", body: <>The endpoint URL, a JSON body with <code className="font-mono text-[0.8125rem]">{"{{input}}"}</code> where the scenario goes, and the path to the reply. An auth header&apos;s value is encrypted and only ever decrypted on the server.</> },
            { title: "A receipt before the run", body: "One harmless request goes first and its reply is saved, so you can confirm you are testing the thing you think you are testing." },
            { title: "Limits on every call", body: "30 seconds and 256 KB per reply, the whole body included. Only public addresses are called; a redirect is reported, never followed." },
            { title: "Each scenario on its own channel", body: <>Multi-turn scenarios need a <code className="font-mono text-[0.8125rem]">{"{{history}}"}</code> slot; injected data needs <code className="font-mono text-[0.8125rem]">{"{{context}}"}</code>. Without one, the scenario is recorded as not run — never flattened into a different test.</> },
          ]}
        />
      </Section>

      <Section
        paper
        index="02"
        id="stages-heading"
        title="Cheapest sufficient evidence first"
        lede="Each reply goes through three stages in order. The first that settles it decides, and the report names which one did."
      >
        <Stages
          items={[
            {
              name: "Rules",
              body: "Text that must or must not appear, tools allowed, forbidden, required or in order, approval before an action, no retry after a failure, latency.",
              outcome: "A rule can fail a scenario and can never pass one. A rule-settled case names no model.",
            },
            {
              name: "Read-back",
              body: "A read-only GET to your own system checks whether the action the agent claimed actually happened. The response body is never stored.",
              outcome: "Confirmed, contradicted or unavailable. A contradiction fails the case with no model asked.",
            },
            {
              name: "Models",
              body: "Whatever is still open goes to models at temperature 0, each reading the scenario's expected behaviour and assertions against the reply.",
              outcome: "On Novera's keys, two vendors must agree; a third model settles a split.",
            },
          ]}
        />
      </Section>

      <Section
        index="03"
        id="consensus-heading"
        title="Two vendors, and a third to settle"
        lede="A single model re-grading identical replies drifts. A verdict here is the finding of two models from different vendors."
      >
        <Points
          columns={2}
          items={[
            ["Independence is derived, not assumed.", "It is read from the stored votes, so a second opinion from the same vendor is reported as exactly that."],
            ["Your own key grades on your key alone.", "Its route is built from the models you named and Novera proved; the report says corroborated within one vendor, or not corroborated."],
            ["A deadlock is not a guess.", "If two models split and a third cannot settle it, the scenario is recorded as disputed and given no verdict."],
            ["Every report names its graders.", "And counts how its verdicts were reached: agreed, settled by a third model, or not corroborated."],
          ]}
        />
      </Section>

      <Section
        paper
        index="04"
        id="missing-heading"
        title="Missing evidence is never a pass"
        lede="A broken integration that turns into a plausible verdict is the failure this design exists to prevent."
      >
        <Cards
          columns={3}
          items={[
            { title: "Counted separately", body: "A scenario that errored, never ran, or had an action nothing could evidence is its own state — listed, never counted as a pass." },
            { title: "Three coverage figures", body: "Execution, resolution and evidence. Each is left empty, not shown as 0 or 100, when the run carries nothing to compute it from." },
            { title: "INCOMPLETE or WITHHELD", body: "INCOMPLETE: scenarios never ran — run the suite again. WITHHELD: everything ran but the evidence does not support a letter — fix what made it unusable." },
          ]}
        />
      </Section>

      <Section
        index="05"
        id="ci-heading"
        title="Sealed, then read by your pipeline"
        lede="A report is sealed when its run completes. A run that was stopped or failed is never sealed."
      >
        <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:items-center [&>*]:min-w-0">
          <Points
            items={[
              ["A SHA-256 digest", "covers the sealed content and chains to the previous report for the same agent."],
              ["Four downloads.", "Markdown, CSV, JSON and JUnit XML. In JUnit, a scenario with no result is an error — never a failure and never a pass."],
              ["Start runs from CI.", "A REST call with an Idempotency-Key starts a run; retrying it returns the same run instead of a second one."],
              ["A gate that reads the evidence.", "Missing evidence exits 2 and stops a release just as a failure does."],
            ]}
          />
          <ExitCodes />
        </div>
      </Section>

      <NotCertification
        items={[
          ["Not a certification.", "Novera is evidence of testing."],
          ["Model grading is not infallible.", "The report says how many verdicts agreed, how many a third model settled, and how many could not be corroborated."],
          ["One dated run.", "One suite version against one policy version."],
          ["Only the suite.", "Not your agent's behaviour on every conversation."],
        ]}
      />

      <ClosingCta
        signedIn={signedIn}
        title="Point it at your agent's endpoint"
        lede="Three free runs, graded on Novera's keys or your own. No card, and about ten minutes to a first report."
        secondary={{ href: "/docs/cli-and-ci", label: "Reports in CI" }}
      />
    </SolutionFrame>
  );
}
