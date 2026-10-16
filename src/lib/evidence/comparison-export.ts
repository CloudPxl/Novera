import { DELTA_CAUSE_SENTENCE, DELTA_LABEL, type DeltaCategory, type DeltaCause, type ScenarioDelta, type ScenarioDeltas, type VerdictState } from "./compare.ts";
import { REPORT_NOTICE_PARAGRAPHS, REPORT_NOTICE_TITLE, REPORT_NOTICE_VERSION } from "../legal/notices.ts";

/**
 * The comparison of two runs as a document to attach to an audit file: Markdown or JSON, built
 * from the same `scenarioDeltas` the page shows (read by `loadComparison`), never from a second
 * comparison.
 *
 * What it holds: both runs (ids, times, suite and its digest, the report's SHA-256 seal, the agent),
 * the summary in the page's own words, a row for each scenario that changed, and the standing notice
 * that this is testing evidence, not a certification. What it never holds: an input, a reply, a
 * transcript or a rationale. Only verdicts, ids, titles, severities and hashes, so a comparison can
 * be handed to a third party without handing over raw evidence.
 *
 * The comparison is not itself sealed; each run's seal is named in it, beside the content. Pure, so
 * the route and the tests build the same bytes.
 */

export const COMPARISON_EXPORT_FORMAT = "novera-comparison/1";
export const COMPARISON_EXPORT_TITLE = "Novera Run Comparison Appendix";
export type ComparisonExportFormat = "md" | "json";

export interface ExportRun {
  id: string;
  /** completed | aborted: a comparison is only built for settled runs. */
  status: string;
  startedAt: string | null;
  completedAt: string | null;
  agent: string;
  suite: { name: string; key: string; version: number; digest: string | null };
  /** The newest sealed report for the run: its SHA-256, or null when none was sealed. */
  seal: { sha256: string; sealedAt: string; withdrawnAt: string | null } | null;
}

export interface ExportScenario {
  id: string;
  title: string;
  severity: string;
  change: string;
  /** Verdict words, or "not in suite" where the scenario is not in that run's suite. */
  before: string;
  after: string;
  cause: { key: DeltaCause; sentence: string } | null;
}

export interface ComparisonExport {
  format: typeof COMPARISON_EXPORT_FORMAT;
  title: typeof COMPARISON_EXPORT_TITLE;
  generated_at: string;
  comparable: true;
  runs: { base: ExportRun; target: ExportRun };
  summary: {
    /** "No previously passing scenario failed" or "N previously passing scenarios now fail". */
    headline: string;
    regressed: number;
    fixed: number;
    graders_moved: number;
    lines: string[];
    compared: number;
    previously_passing: number;
    suite_changed: boolean;
    other_differences: string[];
  };
  scenarios: ExportScenario[];
  notice: { title: string; version: string; text: string[] };
}

export interface ComparisonRefusalExport {
  format: typeof COMPARISON_EXPORT_FORMAT;
  title: typeof COMPARISON_EXPORT_TITLE;
  generated_at: string;
  comparable: false;
  reason: string;
  sentence: string;
  notice: ComparisonExport["notice"];
}

const NOTICE = { title: REPORT_NOTICE_TITLE, version: REPORT_NOTICE_VERSION, text: [...REPORT_NOTICE_PARAGRAPHS] };

const VERDICT_WORD: Record<VerdictState, string> = { pass: "passed", fail: "failed", error: "no result", not_run: "not run" };

/** Scenarios whose two runs differ in verdict or definition; unchanged ones are counted, not listed. */
const CHANGED: ReadonlySet<DeltaCategory> = new Set<DeltaCategory>([
  "regressed", "fixed", "verdict_moved_same_reply", "no_result_now", "result_again", "added", "retired", "redefined",
]);

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** The page's two headline sentences, word for word. */
export function regressionHeadline(regressed: number): string {
  return regressed === 0 ? "No previously passing scenario failed" : `${count(regressed, "previously passing scenario now fails", "previously passing scenarios now fail")}`;
}

export function fixedLine(fixed: number): string {
  return `${count(fixed, "scenario now passes", "scenarios now pass")}`;
}

export function gradersMovedLine(moved: number): string {
  return `${count(moved, "scenario", "scenarios")} where the reply was unchanged and only the graders moved`;
}

function verdict(state: VerdictState | null): string {
  return state === null ? "not in suite" : VERDICT_WORD[state];
}

function scenarioOf(d: ScenarioDelta, titles: ReadonlyMap<string, string>): ExportScenario {
  return {
    id: d.caseId,
    title: titles.get(d.caseId) ?? d.caseId,
    severity: d.severity,
    change: DELTA_LABEL[d.category],
    before: verdict(d.base),
    after: verdict(d.target),
    cause: d.cause ? { key: d.cause, sentence: DELTA_CAUSE_SENTENCE[d.cause] } : null,
  };
}

export function buildComparisonExport(args: {
  base: ExportRun;
  target: ExportRun;
  deltas: ScenarioDeltas;
  /** What differed besides the agent (`configurationDiff().changes`). */
  otherDifferences: readonly string[];
  /** Scenario id to its title, in the words the run page uses. A missing id falls back to the id. */
  titles: ReadonlyMap<string, string>;
  now: Date;
}): ComparisonExport {
  const { deltas } = args;
  const regressed = deltas.counts.regressed;
  const fixed = deltas.counts.fixed;
  const moved = deltas.counts.verdict_moved_same_reply;
  const compared = deltas.definitions.identical;
  const headline = compared === 0 ? "No scenario could be compared: none is defined identically in both runs" : regressionHeadline(regressed);
  return {
    format: COMPARISON_EXPORT_FORMAT,
    title: COMPARISON_EXPORT_TITLE,
    generated_at: args.now.toISOString(),
    comparable: true,
    runs: { base: args.base, target: args.target },
    summary: {
      headline,
      regressed,
      fixed,
      graders_moved: moved,
      lines: [fixedLine(fixed), gradersMovedLine(moved)],
      compared,
      previously_passing: deltas.comparedPasses,
      suite_changed: !deltas.definitions.match,
      other_differences: [...args.otherDifferences],
    },
    scenarios: deltas.deltas.filter((d) => CHANGED.has(d.category)).map((d) => scenarioOf(d, args.titles)),
    notice: NOTICE,
  };
}

export function buildComparisonRefusal(args: { reason: string; sentence: string; now: Date }): ComparisonRefusalExport {
  return {
    format: COMPARISON_EXPORT_FORMAT,
    title: COMPARISON_EXPORT_TITLE,
    generated_at: args.now.toISOString(),
    comparable: false,
    reason: args.reason,
    sentence: args.sentence,
    notice: NOTICE,
  };
}

export function serializeComparisonJson(doc: ComparisonExport | ComparisonRefusalExport): string {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

const cell = (text: string) => text.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const when = (at: string | null) => (at ? `${at.slice(0, 19).replace("T", " ")} UTC` : "not recorded");

function runLines(role: string, run: ExportRun): string[] {
  return [
    `### ${role}`,
    "",
    `- Run: \`${run.id}\``,
    `- Agent: ${run.agent}`,
    `- Started: ${when(run.startedAt)}`,
    `- Completed: ${run.status === "aborted" ? "stopped before the end" : when(run.completedAt)}`,
    `- Suite: ${run.suite.name} (${run.suite.key} v${run.suite.version})`,
    `- Suite digest (SHA-256): ${run.suite.digest ? `\`${run.suite.digest}\`` : "not recorded (the run predates suite digests)"}`,
    run.seal
      ? `- Sealed report (SHA-256): \`${run.seal.sha256}\`, sealed ${when(run.seal.sealedAt)}${run.seal.withdrawnAt ? `, withdrawn ${when(run.seal.withdrawnAt)}` : ""}`
      : "- Sealed report: not sealed",
    "",
  ];
}

function noticeLines(): string[] {
  return ["---", "", `**${NOTICE.title}** (notice version ${NOTICE.version})`, "", ...NOTICE.text.flatMap((p) => [p, ""])];
}

export function renderComparisonMarkdown(doc: ComparisonExport | ComparisonRefusalExport): string {
  const out: string[] = [`# ${doc.title}`, "", `Generated ${when(doc.generated_at)} from the stored runs of one workspace. This comparison is not itself a sealed document; each run's seal is named below.`, ""];

  if (!doc.comparable) {
    out.push("## These runs cannot be compared", "", doc.sentence, "", ...noticeLines());
    return `${out.join("\n").trimEnd()}\n`;
  }

  out.push("## Runs", "", ...runLines("Base", doc.runs.base), ...runLines("Target", doc.runs.target));
  out.push("## Summary", "", `**${doc.summary.headline}.**`, "");
  for (const line of doc.summary.lines) out.push(`- ${line}`);
  out.push(`- ${count(doc.summary.compared, "scenario", "scenarios")} compared; ${doc.summary.previously_passing} passed in the base run.`);
  out.push("");
  if (doc.summary.suite_changed) out.push("The suite changed between the runs: scenarios added, retired or redefined are listed but not compared.", "");
  if (doc.summary.other_differences.length) {
    out.push("What else differed between the runs:", "", ...doc.summary.other_differences.map((c) => `- ${c}`), "");
  }

  out.push("## Changed scenarios", "");
  if (doc.scenarios.length === 0) {
    out.push("No scenario changed between the two runs.", "");
  } else {
    out.push("| Scenario | Title | Severity | Before | After | Change | Cause |", "| --- | --- | --- | --- | --- | --- | --- |");
    for (const s of doc.scenarios) {
      out.push(`| ${cell(s.id)} | ${cell(s.title)} | ${cell(s.severity)} | ${cell(s.before)} | ${cell(s.after)} | ${cell(s.change)} | ${cell(s.cause?.sentence ?? "")} |`);
    }
    out.push("");
  }
  out.push(...noticeLines());
  return `${out.join("\n").trimEnd()}\n`;
}

/** The download's file name: the agent-free, id-only form, so no customer text lands in a header. */
export function comparisonFileName(baseId: string, targetId: string, format: ComparisonExportFormat): string {
  return `novera-comparison-${baseId.slice(0, 8)}-${targetId.slice(0, 8)}.${format}`;
}
