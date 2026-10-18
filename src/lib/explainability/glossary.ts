import "server-only";

/**
 * The words Novera uses on its screens, explained once, in one place.
 *
 * Every entry says what a thing is, why it matters and what to do next, in plain English.
 * Each statement is a statement about this product as built (data/docs, src/lib/judge,
 * src/lib/evidence, src/lib/report), never about what a tool of this kind usually does.
 * "What to do next" names a page or a button that exists.
 *
 * Read by the ExplainTrigger component (src/components/ui/explain-trigger.tsx). A key is a
 * promise to the screens that use it, so a rename is a search across src/ (tests/explainability
 * does it). The text follows the language rule (src/lib/report/language.ts): evidence of testing,
 * never a certification, and no claim of compliance.
 *
 * Some names differ from the ones a roadmap might use, because the product says it another way:
 * an unsettled disagreement is `unresolved_disagreement` (the case is "unresolved", the
 * coverage count "disputed"); a transport error is `agent_unreachable`; a policy digest is
 * `suite_digest`, because a policy here is the customer's own text and has its own versions;
 * BYOK routing is `own_key`.
 */

import { AI_ACT_FRAMING_SUMMARY } from "../legal/ai-act-framing.ts";

export type ExplainKey =
  | "grade_withheld"
  | "grade_incomplete"
  | "consensus_tiebreaker"
  | "unresolved_disagreement"
  | "one_grader_only"
  | "readback_contradiction"
  | "readback_unavailable"
  | "action_not_verified"
  | "agent_unreachable"
  | "status_scope"
  | "sha256_seal"
  | "seal_ledger"
  | "chained_report"
  | "declared_manifest"
  | "severity"
  | "severity_tier"
  | "suite_digest"
  | "policy_version"
  | "own_key"
  | "coverage"
  | "regression_delta"
  | "test_data"
  | "trial_allowance"
  | "run_funding"
  | "not_run"
  | "withdrawn_report"
  | "ai_act_references";

export interface ExplainEntry {
  /** Equal to its key in `GLOSSARY`. */
  id: ExplainKey;
  /** What the marker is named for assistive technology: "What is this? <title>". */
  title: string;
  /** One or two sentences. */
  whatItMeans: string;
  whyItMatters: string;
  /** A step that exists in the product, naming the page or button. */
  nextAction: string;
  /** A published page, `/docs/<slug>`, where `<slug>` is a file in data/docs. */
  docsHref?: string;
}

export const GLOSSARY: Record<ExplainKey, ExplainEntry> = {
  grade_withheld: {
    id: "grade_withheld",
    title: "Grade withheld",
    whatItMeans:
      "Every scenario ran, but the evidence does not support a letter: some scenarios produced no verdict, for example an error, two graders who could not agree, or an action nothing could verify. Novera shows no grade rather than one calculated over the scenarios that happened to work.",
    whyItMatters:
      "A letter over partial evidence would claim more than the run showed. A scenario with no verdict is never counted as a pass.",
    nextAction:
      "Open the Cases tab, choose No result, and read why each scenario has no verdict. Fix what it names, then use Rerun and compare against this: running again without a fix changes nothing on its own.",
    docsHref: "/docs/how-a-run-works",
  },

  grade_incomplete: {
    id: "grade_incomplete",
    title: "Not graded: incomplete",
    whatItMeans:
      "Some scenarios never ran, either because the run did not finish or because Novera's own rules held them back from your agent. No grade is shown, because it would describe the scenarios that ran and say nothing about the rest.",
    whyItMatters:
      "A grade over a partial run would look like a result for the whole suite. The share of the suite with no verdict is stated instead.",
    nextAction:
      "Open the Cases tab to see which scenarios did not run and why. Change the setting a scenario names if it names one, then use Rerun and compare against this.",
    docsHref: "/docs/how-a-run-works",
  },

  consensus_tiebreaker: {
    id: "consensus_tiebreaker",
    title: "A third grader settled it",
    whatItMeans:
      "Two grading models read the same reply differently, so a third model was asked to break the tie. The verdict is the side the third model agreed with.",
    whyItMatters:
      "One model's reading can drift. Asking a third keeps a split decision from resting on whichever model answered first, and the report counts how many verdicts needed one.",
    nextAction:
      "Nothing is required. To check a verdict you doubt, open the scenario on the Cases tab, read each model's vote, and record your own finding beside it.",
    docsHref: "/docs/how-a-run-works",
  },

  unresolved_disagreement: {
    id: "unresolved_disagreement",
    title: "Graders could not agree",
    whatItMeans:
      "Two grading models disagreed and a third could not settle it, so the scenario has no verdict. It is recorded as unresolved, never decided by a guess, and is counted as neither a pass nor a fail.",
    whyItMatters:
      "Picking a side would present a coin toss as evidence. The scenario counts toward the share of the suite with no verdict, so the grade is withheld.",
    nextAction:
      "Open the scenario on the Cases tab, read the reply, and record your own finding on it. A sharper expected behavior in the suite helps the graders agree next time.",
    docsHref: "/docs/how-a-run-works",
  },

  one_grader_only: {
    id: "one_grader_only",
    title: "One grader only",
    whatItMeans:
      "Only one grading model could be reached for this scenario, so its verdict was not confirmed by a second one. A pass given this way is not counted as corroborated.",
    whyItMatters:
      "A release gate (the CLI, exports, API and webhooks) reads such a pass as incomplete evidence rather than as a pass, on every report sealed with that rule.",
    nextAction:
      "Run the suite again once a second grader can be reached. On your own model key, naming two models under Settings, Grading lets a second one confirm.",
    docsHref: "/docs/limitations",
  },

  readback_contradiction: {
    id: "readback_contradiction",
    title: "Your own system disagrees",
    whatItMeans:
      "The agent said it did something, and the read-only check of your own system does not show it. The scenario fails on that basis alone, with no grading model asked.",
    whyItMatters:
      "A claimed action is not a verified one. This finding rests on your system's record, not on how the reply was worded, so it is the strongest one a run can make.",
    nextAction:
      "Check the action in your own system. If it did not happen, fix the agent. If the read-back path or the expectation is wrong, correct it under Verifying what the agent does on the agent's page, then retest.",
    docsHref: "/docs/evidence-integrity",
  },

  readback_unavailable: {
    id: "readback_unavailable",
    title: "Read-back unavailable",
    whatItMeans:
      "The agent claimed an action, but the read-only endpoint that would confirm it did not answer in a usable way. The scenario has no verdict, which is a different gap from having no read-back set up.",
    whyItMatters:
      "The action may or may not have happened, so Novera records neither a pass nor a fail. It is never counted as a pass.",
    nextAction:
      "Open the agent's page, check what the read-only endpoint answered under Verifying what the agent does, and fix it. Check your own system before you retest, because the first attempt may already have acted.",
    docsHref: "/docs/evidence-integrity",
  },

  action_not_verified: {
    id: "action_not_verified",
    title: "Unable to verify an action",
    whatItMeans:
      "The agent described doing something and nothing independent of the agent confirmed it: no tool activity was recorded, or no read-back is set up. The pass is withheld and the scenario has no verdict.",
    whyItMatters:
      "Novera does not accept an agent's own account of an action as proof. This is a limit of the test setup, not a finding against the agent.",
    nextAction:
      "On the agent's page, set up a read-only endpoint under Verifying what the agent does, or point the tool-activity path at where replies list tool calls. Then retest.",
    docsHref: "/docs/evidence-integrity",
  },

  agent_unreachable: {
    id: "agent_unreachable",
    title: "Agent unreachable",
    whatItMeans:
      "Novera could not get an answer from your agent: there was no connection or no reply in time, or the agent answered HTTP 408, 429, 502, 503 or 504. The scenario is recorded as an error, never as a failure of the agent.",
    whyItMatters:
      "Three in a row stop the run and no report is sealed, so an outage can never pass for a result.",
    nextAction:
      "Check that the agent's endpoint is up and reachable from the internet, re-check the connection on the agent's page, then run the suite again.",
    docsHref: "/docs/connecting-an-agent",
  },

  status_scope: {
    id: "status_scope",
    title: "Novera's status and your agent",
    whatItMeans:
      "This page reports Novera's own components. An agent that cannot be reached during a run is a result about your agent's endpoint, not about Novera, and it is recorded as a case error, never as a failure.",
    whyItMatters:
      "A run that could not finish is never sealed, and three unreachable answers in a row stop it, so an outage on either side cannot pass for a result. Nothing on this page changes a stored verdict.",
    nextAction:
      "If a run stopped on an unreachable agent, check the agent's endpoint and run the suite again. If a component here is degraded, try again later or contact support.",
    docsHref: "/docs/how-a-run-works",
  },

  sha256_seal: {
    id: "sha256_seal",
    title: "SHA-256 seal",
    whatItMeans:
      "A SHA-256 digest is a fingerprint of the report's sealed content. Change one figure or one word in it and the digest no longer matches.",
    whyItMatters:
      "It lets anyone check that a report was not edited after it was issued, without taking Novera's word for it. It records what was tested; it is not a certification.",
    nextAction:
      "Paste the digest into the seal check at /verify, or check a downloaded JSON export there. The Seal button on the run page shows the command that recomputes it yourself.",
    docsHref: "/docs/evidence-integrity",
  },

  seal_ledger: {
    id: "seal_ledger",
    title: "Novera's ledger",
    whatItMeans:
      "The ledger is the record Novera keeps of every report it has sealed, each under its digest. The check asks whether a report was sealed with this digest and whether the stored copy still hashes to it.",
    whyItMatters:
      "A matching digest says what Novera sealed. A withdrawn report shows only that it was withdrawn and when, and a deleted workspace's reports are no longer stored.",
    nextAction:
      "To confirm that the copy you hold is the sealed document, drop its JSON export on the seal check at /verify.",
    docsHref: "/docs/evidence-integrity",
  },

  chained_report: {
    id: "chained_report",
    title: "Report chain",
    whatItMeans:
      "Each report names the SHA-256 of the previous report for the same agent, so an agent's reports form a chain. The first report for an agent says that it has nothing to chain to.",
    whyItMatters:
      "A missing or replaced earlier report shows up as a link that no longer matches, so history cannot be rewritten quietly.",
    nextAction:
      "Follow the previous-report link on the seal check to read the one before. Reports sealed before the chain existed say they carry no link.",
    docsHref: "/docs/evidence-integrity",
  },

  declared_manifest: {
    id: "declared_manifest",
    title: "Inputs declared before the run",
    whatItMeans:
      "Before a run sends anything, Novera records its inputs: the suite version and scenario ids in order, the policy version, the agent host, the grading plan, the pass mark and the runner version.",
    whyItMatters:
      "The database refuses to change that record afterwards, so the inputs cannot have been chosen once the answers were known. Its digest is sealed into the report.",
    nextAction:
      "Open the Evidence tab of a run: the readiness check says whether this run has a declared manifest, and the Seal button lists its digest.",
    docsHref: "/docs/evidence-integrity",
  },

  severity: {
    id: "severity",
    title: "Severity",
    whatItMeans:
      "Severity says how serious a failure of a scenario would be: critical, high, medium or low. It orders what needs a look first, and a failed critical scenario is marked on its category.",
    whyItMatters:
      "A critical scenario is put to a third model even when the first two agree. Severity never changes whether a scenario passed, and the score does not weight it.",
    nextAction:
      "On a run's Cases tab, use the Severity filter to start with the critical and high scenarios that did not pass.",
    docsHref: "/docs/writing-a-suite",
  },

  severity_tier: {
    id: "severity_tier",
    title: "Severity tier",
    whatItMeans:
      "A tier groups scenarios by what a failure would touch: a legal or safety boundary, a business rule, or tone and style. It is a triage label for deciding what to read first.",
    whyItMatters:
      "It is not a legal finding, and it says nothing about whether a duty applies to you. The duty references on a scenario only file the evidence for a reader who already carries them.",
    nextAction:
      "Read the legal or safety boundary tier first, then business rules, then tone and style. Open a scenario in Scenarios to see what it checks.",
    docsHref: "/docs/writing-a-suite",
  },

  suite_digest: {
    id: "suite_digest",
    title: "Suite digest",
    whatItMeans:
      "A fingerprint (SHA-256) of one suite version's exact scenarios, in order. Two suite versions hold the same scenario only when its fingerprint matches.",
    whyItMatters:
      "It shows that the scenarios a report names are the ones that were run. It is a fingerprint of the suite, not of your own policy, which has its own versions.",
    nextAction:
      "Open Scenarios to see the suite version. To test different scenarios, import or build a new version: an existing one never changes.",
    docsHref: "/docs/writing-a-suite",
  },

  policy_version: {
    id: "policy_version",
    title: "Policy version",
    whatItMeans:
      "Each time you save your agent's policy, Novera stores it as the next numbered version, and a run is graded against the version in force when it started. A saved version is never edited.",
    whyItMatters:
      "A report always names the exact text the agent was tested against, and earlier versions and the runs graded on them are kept.",
    nextAction:
      "Edit the policy under the Policy tab on the agent's page. Saving creates the next version; run the suite again to compare.",
    docsHref: "/docs/how-a-run-works",
  },

  own_key: {
    id: "own_key",
    title: "Graded on your own key",
    whatItMeans:
      "A workspace with its own model key has all of its model work, grading included, done on that key and never on Novera's. If that key cannot answer, Novera does not fall back to its own.",
    whyItMatters:
      "Every report states who funded the grading, and that statement has to stay true. One model, or two from one vendor, is reported as not corroborated or corroborated within one vendor.",
    nextAction:
      "Manage the key under Settings, Grading. Removing it puts the workspace back on Novera's keys.",
    docsHref: "/docs/the-trial-and-your-own-key",
  },

  coverage: {
    id: "coverage",
    title: "Coverage",
    whatItMeans:
      "Coverage is three numbers: how much of the suite ran, how much of what ran has an accountable outcome, and how much of the proof the scenarios asked for was observed. A figure is left empty rather than shown as 0 or 100 when the run holds nothing to compute it from.",
    whyItMatters:
      "One percentage cannot show how much of an evaluation is missing. Scenarios that errored or never ran are counted on their own lines and never as passes.",
    nextAction:
      "Read the counts beside it, then open the Cases tab and choose No result to see the scenarios behind the gap.",
    docsHref: "/docs/what-the-report-contains",
  },

  regression_delta: {
    id: "regression_delta",
    title: "Fixed and newly failing",
    whatItMeans:
      "A comparison with an earlier run of the same suite lists what was fixed, what newly broke, what still fails and what lost its result. A verdict that moved on an identical reply is the graders changing, not your agent.",
    whyItMatters:
      "Novera keeps a fingerprint of every reply, so it can tell an agent that changed from graders that did.",
    nextAction:
      "Open the Comparison tab of a run to see why each scenario moved, or choose a different run as the baseline.",
    docsHref: "/docs/how-a-run-works",
  },

  test_data: {
    id: "test_data",
    title: "Test data",
    whatItMeans:
      "This run used Novera's scripted fixture, or these lines were written by a model playing a customer. It is not a real agent or a real customer.",
    whyItMatters:
      "A fixture is never presented as a real external action, so figures from it say nothing about your own agent.",
    nextAction:
      "To test your own agent, use Connect an agent on the Agents page, then run the suite there.",
    docsHref: "/docs/connecting-an-agent",
  },

  trial_allowance: {
    id: "trial_allowance",
    title: "Trial allowance",
    whatItMeans:
      "Each account gets three free runs, counted across every workspace you own, so a second workspace does not start a second trial. They are graded on Novera's keys, or on your own key if you have connected one.",
    whyItMatters:
      "After the three runs, a run starts only when a plan or a grant funds it. The trial is how you see a first sealed report before deciding.",
    nextAction:
      "The top bar shows how many runs are left. Plans are listed under Settings, Billing.",
    docsHref: "/docs/the-trial-and-your-own-key",
  },

  run_funding: {
    id: "run_funding",
    title: "Who funded the grading",
    whatItMeans:
      "Every report states who paid for the model work behind its verdicts: Novera's trial allowance, a plan's managed runs on Novera's keys, a grant from Novera such as a pilot, or the workspace's own model key.",
    whyItMatters:
      "A reader can judge the evidence knowing which models graded it. A plan's managed runs and a pilot's runs are never called the trial, and a pilot is never called a plan.",
    nextAction:
      "Change what funds a workspace's runs under Settings, Grading for your own key, or under Settings, Billing for a plan or a pilot code.",
    docsHref: "/docs/the-trial-and-your-own-key",
  },

  not_run: {
    id: "not_run",
    title: "Not run",
    whatItMeans:
      "The scenario never reached your agent, because the run stopped early or because Novera's own rules held it back, for example a destructive scenario against an agent marked as production. It is counted on its own line and never as a pass.",
    whyItMatters:
      "Counting it as run would make the evidence look more complete than it is. While any scenario is not run, the grade is incomplete.",
    nextAction:
      "Open the scenario to see why it was held back. Mark a test copy as a test target on the agent's page, or add the missing slot to its request template, then run the suite again.",
    docsHref: "/docs/how-a-run-works",
  },

  withdrawn_report: {
    id: "withdrawn_report",
    title: "Withdrawn report",
    whatItMeans:
      "Withdrawing a report stops its link and every download at once, for everyone who holds them, and records who withdrew it. A withdrawn report stays withdrawn.",
    whyItMatters:
      "Anyone who checks its digest afterwards is told only that it was withdrawn, and when. It cannot be reopened, so a new run is the way to a new report.",
    nextAction:
      "To withdraw a report, open its run, choose the Evidence tab and use Withdraw this report under Before you send it.",
    docsHref: "/docs/what-the-report-contains",
  },

  ai_act_references: {
    id: "ai_act_references",
    title: "AI Act references",
    whatItMeans: `${AI_ACT_FRAMING_SUMMARY.transparency} ${AI_ACT_FRAMING_SUMMARY.highRisk}`,
    whyItMatters: `${AI_ACT_FRAMING_SUMMARY.benchmark} ${AI_ACT_FRAMING_SUMMARY.determination}`,
    nextAction:
      "Open the regulatory mapping to see which scenarios sit under each reference. Ask your counsel whether your agent is high-risk before treating any of them as a duty.",
  },
};

/** Every key, in the order the registry lists them. */
export const EXPLAIN_KEYS = Object.keys(GLOSSARY) as ExplainKey[];
