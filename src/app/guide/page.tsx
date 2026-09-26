import type { Metadata } from "next";
import Link from "next/link";
import { currentUser } from "@/lib/auth/session.ts";

export const metadata: Metadata = {
  title: "How to use Novera · Guide",
  description: "Step by step: connect an agent, write its policy, run the suite, read the results and share the report.",
};
export const dynamic = "force-dynamic";

const STEPS: Array<{ title: string; body: string; where: string; href: string }> = [
  {
    title: "Connect the agent you want to test",
    body: "Give Novera the web address your support agent answers on, and confirm you own it or are authorised to test it. Novera sends it one harmless test message straight away, so you know the connection works before anything else.",
    where: "Connect an agent",
    href: "/agents/new",
  },
  {
    title: "Write the policy it should follow",
    body: "Paste the rules your agent is meant to keep: refunds, identity checks, what it may and may not say. Every verdict is judged against this text. Saving a change creates a new version; old versions are kept, so every report says exactly which rules it was measured against.",
    where: "The agent's page → Policy",
    href: "/dashboard",
  },
  {
    title: "Run the suite",
    body: "A suite is a fixed set of scenarios — ordinary requests, tricky ones and deliberate attacks. Novera sends each one to your agent and grades the answer. The newest suite version is picked for you. A run takes about a minute and keeps going even if some scenarios fail.",
    where: "The agent's page → Run the suite",
    href: "/dashboard",
  },
  {
    title: "Read the results",
    body: "Each scenario ends as passed, failed, or without a result. Without a result is never counted as a pass: it means the agent errored, the grading models could not agree, or an action the agent claimed could not be checked. The score is passes out of the scenarios that got a verdict, and the report says how many did not.",
    where: "The run page",
    href: "/dashboard",
  },
  {
    title: "Fix, then rerun and compare",
    body: "On a failed scenario you can ask for a diagnosis: Novera proposes a change to your policy, quoting the exact passage. You approve or reject it — nothing changes on its own. Then rerun: the new run is compared with the old one, scenario by scenario, and flags any scenario that flips between runs on its own.",
    where: "The run page → a failed scenario",
    href: "/dashboard",
  },
  {
    title: "Disagree with a verdict, if you do",
    body: "Record your own finding on any scenario, with a reason. It sits beside the automated verdict and never changes the score. If a client should see it, issue a new report that discloses it.",
    where: "The run page → a scenario → Record your own finding",
    href: "/dashboard",
  },
  {
    title: "Share the report",
    body: "Every finished run produces a dated report with a private link. Its fingerprint (a SHA-256 hash) proves nothing was edited after it was issued. Send the link, export it as Markdown, CSV or PDF, or revoke it at any time.",
    where: "The run page → Open the client report",
    href: "/dashboard",
  },
];

const TERMS: Array<[string, string]> = [
  ["Scenario", "One test: a message sent to your agent, what it should do, and what would count as failing."],
  ["Suite", "A numbered set of scenarios. A published version never changes, so two reports on the same version are comparable."],
  ["Policy", "Your written rules for the agent. Verdicts are judged against the version that was current when the run started."],
  ["Verdict", "Passed or failed, decided by a rule in the scenario or by two grading models from different companies. A third model settles any disagreement."],
  ["No result", "The agent errored, the models could not agree, or a claimed action could not be checked. Counted separately — never as a pass."],
  ["Assurance gap", "The share of the suite that produced no verdict. The larger it is, the less the score says."],
  ["Read-back", "An optional read-only address in your own system that Novera checks to confirm an action the agent says it took, such as a refund."],
  ["INCOMPLETE / WITHHELD", "INCOMPLETE: some scenarios never ran — run again. WITHHELD: everything ran but the evidence does not support a grade — fix what made it unusable."],
  ["Report hash", "A fingerprint of the report. Anyone can recompute it; if one character changed, it would not match."],
];

export default async function GuidePage() {
  const signedIn = Boolean(await currentUser());

  return (
    <main id="main" className="mx-auto w-full max-w-3xl bg-surface px-6 py-10 text-ink sm:px-8">
      <nav className="flex items-center justify-between text-sm">
        <Link href="/" className="font-semibold uppercase tracking-[0.18em] text-ink-faint">Novera</Link>
        <Link href={signedIn ? "/dashboard" : "/sign-in"} className="font-medium underline underline-offset-2">
          {signedIn ? "Open your dashboard" : "Sign in"}
        </Link>
      </nav>

      <h1 className="mt-10 text-3xl font-semibold tracking-tight">How to use Novera</h1>
      <p className="mt-3 text-lg leading-relaxed text-ink-soft">
        Seven steps from a connected agent to a report you can hand to a client. The first run
        usually takes about ten minutes, most of it writing the policy.
      </p>

      <ol className="mt-10 space-y-6">
        {STEPS.map((step, i) => (
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
                  <Link href={step.href} className="underline underline-offset-2 hover:text-ink">{step.where}</Link>
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
        {TERMS.map(([term, meaning]) => (
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
  );
}
