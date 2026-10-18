import type { Metadata } from "next";
import { currentUser } from "@/lib/auth/session.ts";
import { solution, solutionMetadata } from "../_components/content.ts";
import { Cards, ClosingCta, Hero, NotCertification, Points, Section, SolutionFrame } from "../_components/solution-ui.tsx";

export const metadata: Metadata = solutionMetadata("agency");

/**
 * For agencies that build and run AI support agents for clients. Every feature named is in
 * the product today: workspaces per client with the portfolio view, roles and invitations
 * (0054), schedules (0036), the API's release gate, signed webhooks, readiness, withdrawal and
 * the reissued report (src/lib/report/reissue.ts). No plan or price is named: prices are
 * approved, not published. The trial is three runs per owner across every workspace they own,
 * and the page says so rather than implying three per client.
 */
export default async function AgencyPage() {
  const signedIn = Boolean(await currentUser());
  const page = solution("agency");

  return (
    <SolutionFrame signedIn={signedIn} current="agency">
      <Hero
        crumb={page.name}
        eyebrow="For agencies · client-facing AI support agents"
        title={<>A sealed evidence report <span className="text-ink-soft">for every client agent you ship.</span></>}
        lead={
          <>
            Keep each client in its own workspace, re-run their suite on a schedule or before a
            release, and hand them a dated report they can check for themselves — failures and
            unknowns included.
          </>
        }
        signedIn={signedIn}
        primary={{ href: "/sign-in?mode=signup", label: "Start with three free runs" }}
        secondary={{ href: "/guide", label: "Read the step-by-step guide" }}
        facts={[
          ["1 workspace", "per client: agents, keys, retention, reports"],
          ["5 roles", "owner, admin, operator, reviewer, auditor"],
          ["Daily or weekly", "schedules at a fixed UTC hour"],
          ["SHA-256", "lets a client check the report they hold"],
        ]}
      />

      <Section
        index="01"
        id="clients-heading"
        title="One workspace per client"
        lede="Agents, policies, model keys, retention and reports stay apart — and every client's state is visible on one page."
      >
        <Cards
          items={[
            { title: "Separate in the database", body: "A row can only refer to rows in its own workspace — agents, policies, runs, suites — and that is checked in the database, not only in the interface." },
            { title: "Each report names its client", body: "Rename a workspace and new reports carry the new name; sealed reports keep the name they were sealed with." },
            { title: "A portfolio view", body: "Every client side by side with its latest result, how many scenarios failed or produced no result, and what is still running." },
            { title: "Invite the client in", body: "As a reviewer to approve the scenarios you drafted for them, or as an auditor to read. Drafting and approving are different roles, and access changes are kept in an audit trail." },
          ]}
        />
      </Section>

      <Section
        paper
        index="02"
        id="ship-heading"
        title="Keep testing after handover"
        lede="A prompt changed on Tuesday and the client noticed first. Re-run before they do."
      >
        <Points
          columns={2}
          items={[
            ["Schedules.", "A pinned suite version, daily or weekly at a fixed UTC hour, so runs compare like with like. A schedule that cannot start pauses and says why."],
            ["Release gate.", "A REST call starts a run; five exit codes tell a pass from a failure from missing evidence, and missing evidence stops the release too."],
            ["Signed webhooks.", "Each finished run is announced with counts and links — never a reply, an input, a policy or a key."],
            ["Rerun and compare.", "Fixed, newly broken, still failing, lost its result — and whether the agent's reply changed or only the graders did."],
            ["Production failures.", "Send in a real failure; it is stored redacted and comes back as a draft scenario a person approves."],
            ["Your key or ours.", "A client workspace with its own model key is graded on that key alone, and the report says who funded the grading."],
          ]}
        />
      </Section>

      <Section
        index="03"
        id="review-heading"
        title="When the client asks questions"
        lede="The report you send is the one that was sealed. Your view of it travels beside it, never inside it."
      >
        <Cards
          items={[
            { title: "Ready to share, or not yet", body: "Before you send it, the run page says whether the report holds up — and why not, check by check. A report with failures can be ready: it is the evidence your client is owed." },
            { title: "Findings beside verdicts", body: "Disagree with a verdict and record your own finding, with a reason. It sits next to the automated verdict and changes no count, grade or score." },
            { title: "Reissue with your review", body: "A new sealed report carries the original unchanged, lists every verdict your team disagreed with and why, and names the original by its hash." },
            { title: "Withdraw a link at once", body: "A report link expires after thirty days and can be withdrawn sooner. The link and every download stop working for everyone, and the withdrawal records who made it." },
          ]}
        />
        <p className="mt-6 max-w-4xl text-sm leading-relaxed text-ink-faint">
          A reissued report says plainly that its reviewers are members of the workspace whose agent
          was tested, so a client reads your findings as yours.
        </p>
      </Section>

      <NotCertification
        items={[
          ["Not a certification.", "What you hand a client is evidence of testing, and the report says so on its cover."],
          ["Not legal advice.", "It does not say which obligations apply to your client."],
          ["One dated run.", "One suite version against one policy version, on the date shown."],
          ["Only agents you may test.", "You confirm you own each agent or are authorised to test it; that confirmation is sealed into its reports."],
        ]}
      />

      <ClosingCta
        signedIn={signedIn}
        title="Run it against a client's agent"
        lede="Three free runs for your account, shared across every client workspace you own. Several clients already? Ask for a pilot and a person replies."
        secondary={{ href: "/apply", label: "Ask for a pilot" }}
      />
    </SolutionFrame>
  );
}
