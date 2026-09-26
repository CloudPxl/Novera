/**
 * The step-by-step guide, in one place: `/guide` renders it for anyone, the dashboard
 * renders it with links into the signed-in person's own workspace. Two copies of the
 * instructions would drift apart the first time either was edited.
 */
export type GuideTarget = "connect" | "agent" | "run";

export const GUIDE_STEPS: Array<{ title: string; body: string; where: string; target: GuideTarget }> = [
  {
    title: "Connect the agent you want to test",
    body: "Give Novera the web address your support agent answers on, and confirm you own it or are authorised to test it. Novera sends it one harmless test message straight away, so you know the connection works before anything else.",
    where: "Connect an agent",
    target: "connect",
  },
  {
    title: "Write the policy it should follow",
    body: "Paste the rules your agent is meant to keep: refunds, identity checks, what it may and may not say. Every verdict is judged against this text. Saving a change creates a new version; old versions are kept, so every report says exactly which rules it was measured against.",
    where: "The agent's page → Policy",
    target: "agent",
  },
  {
    title: "Run the suite",
    body: "A suite is a fixed set of scenarios — ordinary requests, tricky ones and deliberate attacks. Novera sends each one to your agent and grades the answer. The newest suite version is picked for you. A run takes about a minute and keeps going even if some scenarios fail.",
    where: "The agent's page → Run the suite",
    target: "agent",
  },
  {
    title: "Read the results",
    body: "Each scenario ends as passed, failed, or without a result. Without a result is never counted as a pass: it means the agent errored, the grading models could not agree, or an action the agent claimed could not be checked. The score is passes out of the scenarios that got a verdict, and the report says how many did not.",
    where: "The run page",
    target: "run",
  },
  {
    title: "Fix, then rerun and compare",
    body: "On a failed scenario you can ask for a diagnosis: Novera proposes a change to your policy, quoting the exact passage. You approve or reject it — nothing changes on its own. Then rerun: the new run is compared with the old one, scenario by scenario, and flags any scenario that flips between runs on its own.",
    where: "The run page → a failed scenario",
    target: "run",
  },
  {
    title: "Disagree with a verdict, if you do",
    body: "Record your own finding on any scenario, with a reason. It sits beside the automated verdict and never changes the score. If a client should see it, issue a new report that discloses it.",
    where: "The run page → a scenario → Record your own finding",
    target: "run",
  },
  {
    title: "Share the report",
    body: "Every finished run produces a dated report with a private link. Its fingerprint (a SHA-256 hash) proves nothing was edited after it was issued. Send the link, export it as Markdown, CSV, PDF, JSON (to verify a copy) or JUnit (for a CI pipeline), or revoke it at any time.",
    where: "The run page → Open the client report",
    target: "run",
  },
];

export const GUIDE_TERMS: Array<[string, string]> = [
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
