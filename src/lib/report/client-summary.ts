import type { ReportPayload } from "./payload.ts";

/**
 * The plain-text summary an agency pastes into an email, a ticket or a pull request: what was
 * tested, what came out, and where the reader checks the seal for themselves.
 *
 * Every figure is read from the sealed report, never from the page, so the summary says exactly
 * what the document it points to says. Older payload formats lack some fields; each line is left
 * out rather than guessed when its field is absent. It always ends with the non-certification
 * notice, as the report does.
 */
export const CLIENT_SUMMARY_NOTICE = "Testing evidence for the declared scenarios and run time — not a certification.";

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function clientSummary(input: {
  payload: ReportPayload;
  contentHash: string;
  origin: string;
  /** The shared report's path, when a link exists. */
  reportPath?: string | null;
}): string {
  const p = input.payload;
  const c = p.coverage;
  const lines: string[] = [];
  lines.push(`Novera evaluation — ${p.subject.agent}`);
  // The report says it at the same weight as its grade; so does anything copied from it.
  if (/fixture/i.test(p.subject.environment)) lines.push("TEST DATA: run against Novera's scripted test fixture, not a real agent.");
  lines.push(`Suite: ${p.run.suite}${p.run.locale ? ` · language: ${p.run.locale.name} (${p.run.locale.localised} of ${p.run.locale.of} scenarios)` : " · language: English"}`);
  lines.push(`Run: ${p.run.date.slice(0, 16).replace("T", " ")} UTC`);
  if (p.grade) lines.push(`Grade: ${p.grade.band}${p.grade.score !== null ? ` (${p.grade.score}%, pass mark ${p.grade.threshold}%)` : ""}`);
  const noResult = c.errored + c.not_run + (c.disputed ?? 0);
  lines.push(`Scenarios: ${c.planned} planned · ${c.passed} passed · ${c.failed} failed · ${noResult} without a result`);
  if (c.effect_confirmed !== undefined || c.effect_contradicted !== undefined) {
    lines.push(`Claimed actions checked in the client's own system: ${c.effect_confirmed ?? 0} confirmed · ${c.effect_contradicted ?? 0} contradicted`);
  }
  if (p.comparison) {
    const broke = p.comparison.new_failures.length;
    lines.push(
      `Compared with the previous run: ${broke === 0 ? "no previously passing scenario failed" : `${plural(broke, "previously passing scenario")} now ${broke === 1 ? "fails" : "fail"}`}` +
        ` · ${p.comparison.fixed.length} resolved`,
    );
  }
  lines.push(`Seal (SHA-256): ${input.contentHash}`);
  lines.push(`Verify the seal: ${new URL(`/verify/${input.contentHash}`, input.origin).toString()}`);
  if (input.reportPath) lines.push(`Report: ${new URL(input.reportPath, input.origin).toString()}`);
  lines.push(CLIENT_SUMMARY_NOTICE);
  return lines.join("\n");
}

/** The same summary for a comparison of two runs, from the comparison's own counts and each run's seal. */
export function comparisonClientSummary(input: {
  agent: string;
  /** Runs against Novera's scripted test fixture: said on the second line, as on the run summary. */
  testData?: boolean;
  suite: string;
  base: { date: string; seal: string | null };
  target: { date: string; seal: string | null };
  regressed: number;
  fixed: number;
  origin: string;
}): string {
  const at = (iso: string) => `${iso.slice(0, 16).replace("T", " ")} UTC`;
  const lines = [
    `Novera comparison — ${input.agent}`,
    ...(input.testData ? ["TEST DATA: runs against Novera's scripted test fixture, not a real agent."] : []),
    `Suite: ${input.suite}`,
    `Runs: ${at(input.base.date)} → ${at(input.target.date)}`,
    `Result: ${input.regressed === 0 ? "no previously passing scenario failed" : `${plural(input.regressed, "previously passing scenario")} now ${input.regressed === 1 ? "fails" : "fail"}`} · ${input.fixed} resolved`,
  ];
  for (const [label, run] of [["Earlier run", input.base], ["Later run", input.target]] as const) {
    if (run.seal) lines.push(`${label} seal (SHA-256): ${run.seal} — ${new URL(`/verify/${run.seal}`, input.origin).toString()}`);
    else lines.push(`${label}: no sealed report.`);
  }
  lines.push(CLIENT_SUMMARY_NOTICE);
  return lines.join("\n");
}
