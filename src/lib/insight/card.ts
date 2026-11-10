import type { Suite, SuiteCase } from "../runner/types.ts";
import { independenceOf, type Independence } from "../judge/independence.ts";
import { CATEGORY_TITLE, HEADLINES } from "./suite.ts";
import { SCAN_ERROR_LABEL, type InsightObservationRow, type InsightScanRow, type InsightTargetRow } from "./types.ts";

/**
 * The insight card: computed from the stored scan and observation rows every time it is read,
 * never stored, never estimated. Short enough to send; careful enough to defend. Every sentence
 * states what was captured and graded, not what the bot "is".
 */

const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export type CardVerdict = "pass" | "fail" | "no_reply" | "partial" | "grader_error" | "unresolved";

export interface CardScenario {
  id: string;
  category: string;
  categoryTitle: string;
  severity: string;
  verdict: CardVerdict;
  verdictWords: string;
  headline: string | null;
  /** Which graders decided it, as stored; empty for a rule-settled or ungraded scenario. */
  graders: string[];
  independence: Independence | null;
  corroborated: boolean | null;
  settledBy: "deterministic" | "models" | null;
}

export interface InsightCard {
  target: { name: string; url: string };
  scanDate: string | null;
  status: InsightScanRow["status"];
  statusWords: string;
  scenarios: CardScenario[];
  counts: { declared: number; recorded: number; passed: number; failed: number; noResult: number };
  noResult: Record<Exclude<CardVerdict, "pass" | "fail">, number>;
  byCategory: Array<{ category: string; title: string; passed: number; failed: number; noResult: number }>;
  strength: CardScenario | null;
  concern: CardScenario | null;
  corroboration: { independent: number; singleVendor: number; singleModel: number };
  capturedBy: string;
  notTested: string[];
  limitations: string[];
  disclosure: string;
}

export const NOT_TESTED = [
  "Real transactions, orders, bookings, refunds, cancellations, account changes or data exports: nothing behind the widget was acted on.",
  "Tool use and actions the bot may take in its own systems: a widget reply does not show them.",
  "Multi-turn conversations: each prompt was sent in a fresh session.",
  "Security vulnerabilities, credentials or exploit payloads: none were sent.",
  "Accuracy of the bot's domain answers against the vendor's own documentation: the AI graders have not read it.",
];

function verdictOf(o: InsightObservationRow): CardVerdict {
  if (o.status === "pass") return "pass";
  if (o.status === "fail") return "fail";
  if (o.response_text === null) return "no_reply";
  if (o.capture?.partial === true) return "partial";
  if (o.judge_agreement === "unresolved") return "unresolved";
  return "grader_error";
}

const VERDICT_WORDS: Record<CardVerdict, string> = {
  pass: "Passed",
  fail: "Failed",
  no_reply: "No result: no reply arrived",
  partial: "No result: the reply had not finished when the wait ran out",
  grader_error: "No result: the AI graders could not grade it",
  unresolved: "No result: the AI graders disagreed and nothing settled it",
};

function dateOf(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

export function statusWords(scan: Pick<InsightScanRow, "status" | "error_kind" | "aborted_reason">): string {
  switch (scan.status) {
    case "queued": return "Queued: waiting for the browser worker.";
    case "running": return "Running: the browser worker is on the page.";
    case "graded": return "Graded: every declared scenario has an observation.";
    case "aborted": return `Aborted by an operator${scan.aborted_reason ? `: ${scan.aborted_reason}` : "."}`;
    case "error": return scan.error_kind ? SCAN_ERROR_LABEL[scan.error_kind] : "Ended without a result.";
  }
}

export function insightCard(args: {
  target: Pick<InsightTargetRow, "name" | "demo_url">;
  scan: InsightScanRow;
  observations: InsightObservationRow[];
  suite: Suite;
}): InsightCard {
  const { target, scan, observations, suite } = args;
  const byId = new Map(observations.map((o) => [o.scenario_id, o]));
  const scenarios: CardScenario[] = [];
  for (const id of scan.scenario_ids) {
    const c: SuiteCase | undefined = suite.cases.find((x) => x.id === id);
    const o = byId.get(id);
    if (!c || !o) continue;
    const verdict = verdictOf(o);
    const graded = o.settled_by === "models" && o.judge_votes.length > 0;
    const independence = graded ? independenceOf(o.judge_votes) : null;
    scenarios.push({
      id,
      category: c.category,
      categoryTitle: CATEGORY_TITLE[c.category] ?? c.category,
      severity: c.severity,
      verdict,
      verdictWords: VERDICT_WORDS[verdict],
      headline: verdict === "pass" ? HEADLINES[id]?.pass ?? null : verdict === "fail" ? HEADLINES[id]?.fail ?? null : null,
      graders: o.judge_votes.map((v) => v.model),
      independence,
      corroborated: graded ? independence === "independent" : o.settled_by === "deterministic" ? true : null,
      settledBy: o.settled_by,
    });
  }

  const passed = scenarios.filter((s) => s.verdict === "pass");
  const failed = scenarios.filter((s) => s.verdict === "fail");
  const noResult: InsightCard["noResult"] = { no_reply: 0, partial: 0, grader_error: 0, unresolved: 0 };
  for (const s of scenarios) if (s.verdict !== "pass" && s.verdict !== "fail") noResult[s.verdict] += 1;
  const noResultTotal = Object.values(noResult).reduce((a, b) => a + b, 0);

  const bySeverity = (a: CardScenario, b: CardScenario) => (SEVERITY_RANK[a.severity] ?? 9) - (SEVERITY_RANK[b.severity] ?? 9);
  const strength = [...passed].sort(bySeverity)[0] ?? null;
  const concern = [...failed].sort(bySeverity)[0] ?? null;

  const categories = new Map<string, { category: string; title: string; passed: number; failed: number; noResult: number }>();
  for (const s of scenarios) {
    const row = categories.get(s.category) ?? { category: s.category, title: s.categoryTitle, passed: 0, failed: 0, noResult: 0 };
    if (s.verdict === "pass") row.passed += 1;
    else if (s.verdict === "fail") row.failed += 1;
    else row.noResult += 1;
    categories.set(s.category, row);
  }

  const corroboration = { independent: 0, singleVendor: 0, singleModel: 0 };
  for (const s of scenarios) {
    if (s.independence === "independent") corroboration.independent += 1;
    else if (s.independence === "single-vendor") corroboration.singleVendor += 1;
    else if (s.independence === "single-model") corroboration.singleModel += 1;
  }

  const date = dateOf(scan.finished_at ?? scan.created_at);
  const declared = scan.scenario_ids.length;
  const limitations = [
    `${declared} scripted prompt${declared === 1 ? "" : "s"} in one session${date ? ` on ${date}` : ""}; a different day or wording may produce different replies.`,
    "Replies are what the chat widget displayed, captured by Novera's browser worker and redacted before storage; no screenshot was kept.",
    "Each verdict is the finding of AI graders and names them; a verdict from one vendor only is marked not corroborated.",
    "A prompt with no result is counted separately and is never a pass or a failure.",
    "This is an observation of a public demo. It is not a conformity assessment, not a certification, and says nothing about the vendor's production systems.",
  ];
  const n = scenarios.length;

  return {
    target: { name: target.name, url: target.demo_url },
    scanDate: date,
    status: scan.status,
    statusWords: statusWords(scan),
    scenarios,
    counts: { declared, recorded: scenarios.length, passed: passed.length, failed: failed.length, noResult: noResultTotal },
    noResult,
    byCategory: [...categories.values()],
    strength,
    concern,
    corroboration,
    capturedBy: `Captured by Novera's browser worker${date ? ` on ${date}` : ""}; the replies are what the widget displayed.`,
    notTested: NOT_TESTED,
    limitations,
    disclosure: `Independent point-in-time observation conducted by Novera${date ? ` on ${date}` : ""} across ${n} non-destructive prompt${n === 1 ? "" : "s"}. Not commissioned or endorsed by ${target.name}, and not a legal or compliance certification.`,
  };
}

/** The card as plain text, for pasting. Nothing in it that the card does not show. */
export function cardText(card: InsightCard): string {
  const lines: string[] = [];
  lines.push(`${card.target.name} — public demo insight${card.scanDate ? ` (${card.scanDate})` : ""}`);
  lines.push(card.target.url);
  lines.push("");
  lines.push(`Status: ${card.statusWords}`);
  lines.push(`Scenarios: ${card.counts.recorded} of ${card.counts.declared} recorded · ${card.counts.passed} passed · ${card.counts.failed} failed · ${card.counts.noResult} no result`);
  if (card.strength) lines.push(`Notable strength: ${card.strength.headline} (${card.strength.id}, ${card.strength.severity})`);
  if (card.concern) lines.push(`Notable concern: ${card.concern.headline} (${card.concern.id}, ${card.concern.severity})`);
  lines.push("");
  for (const s of card.scenarios) {
    const corr = s.independence === "independent" ? "" : s.independence ? " — not corroborated" : "";
    lines.push(`${s.id} ${s.categoryTitle}: ${s.verdictWords}${corr}${s.graders.length ? ` [${s.graders.join(", ")}]` : s.settledBy === "deterministic" ? " [rule]" : ""}`);
  }
  lines.push("");
  lines.push("Not tested:");
  for (const t of card.notTested) lines.push(`- ${t}`);
  lines.push("");
  lines.push("Limitations:");
  for (const l of card.limitations) lines.push(`- ${l}`);
  lines.push("");
  lines.push(card.disclosure);
  return lines.join("\n");
}
