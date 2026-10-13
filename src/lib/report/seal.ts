import type { ReportPayload } from "./payload.ts";

/**
 * What a report's seal covers, and how anyone can check it, for the seal inspector on the
 * report page and the run page (`src/components/ui/seal-inspector.tsx`).
 *
 * The seal is `contentHash(payload)` (`hash.ts`): SHA-256 over the payload written with
 * object keys sorted, no whitespace and array order kept. It covers the payload and nothing
 * else, so the list below is read from the payload itself, field by field, with an absence
 * branch for every field a format added. A report sealed before a field existed is never
 * described as carrying it.
 *
 * Pure, so the browser, the server and the tests read the same words.
 */

/** The attribution on a printed page with no seal to point at (a run with no report). */
export const NOVERA_ATTRIBUTION = "Novera — testing evidence, not a certification.";

/** The attribution printed above and below a printed report, or a run with a sealed report. */
export const SEAL_ATTRIBUTION = `${NOVERA_ATTRIBUTION} Sealed document: any edit changes the SHA-256 below.`;

export interface SealItem {
  label: string;
  detail: string;
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The sealed fields of this payload, in reading order. */
export function sealContents(payload: ReportPayload): SealItem[] {
  const { subject, run, coverage } = payload;
  const items: SealItem[] = [];
  items.push({
    label: "Document format",
    detail: `Format ${payload.novera?.format ?? "not recorded"}. Each later format added fields; this list names only the ones this report carries.`,
  });
  items.push({
    label: "What was tested",
    detail: `The client (${subject.client}), the agent (${subject.agent}), the environment as recorded for the run, and the authorisation statement stored with it.`,
  });
  items.push({
    label: "Policy",
    detail: `The policy version number (v${subject.policy_version}). The policy text itself is stored with the run, not in this document.`,
  });
  items.push({ label: "Suite", detail: `${run.suite}.` });
  items.push({
    label: "Run",
    detail: `Run ${run.id}, dated ${run.date}${run.duration_ms != null ? `, and its duration (${(run.duration_ms / 1000).toFixed(1)} s)` : ""}.`,
  });
  if (run.pass_threshold !== undefined) items.push({ label: "Pass mark", detail: `${run.pass_threshold}%.` });

  const graders = run.graders
    ? run.graders.length === 0
      ? "No model was asked: every scenario was settled by a rule or a read-back."
      : `Every model that voted, in the role it voted in, and on how many scenarios (${run.graders.map((g) => `${g.model}: ${g.role}, ${plural(g.cases, "scenario")}`).join("; ")}).`
    : run.graded_by.length > 0
      ? `The first model to grade each scenario (${run.graded_by.join(", ")}). This format does not list second opinions or settlers.`
      : "No grading model is named.";
  items.push({ label: "Graders", detail: `${graders} Funded by: ${run.grading_funded_by}.` });
  if (run.corroboration) {
    const c = run.corroboration;
    items.push({
      label: "Corroboration",
      detail: `How each verdict was reached, as counts: ${c.agreed} agreed, ${c.majority} settled by a third model, ${c.uncorroborated} graded by one model, ${c.unresolved} unresolved`
        + (c.independent !== undefined ? `, ${c.independent} confirmed across vendors` : "")
        + (c.settled_by_rule !== undefined ? `, ${c.settled_by_rule} settled by a rule` : "")
        + ". Individual votes are not in the document; they stay with the run.",
    });
  }
  if (payload.grade) items.push({ label: "Grade", detail: `The grade (${payload.grade.band}), its score, the pass mark and the sentence explaining it.` });
  items.push({
    label: "Coverage",
    detail: `Planned ${coverage.planned}, passed ${coverage.passed}, failed ${coverage.failed}, no result ${coverage.errored}, not run ${coverage.not_run}`
      + (coverage.execution_coverage !== undefined ? ", and the executed, reasoned and evidenced shares" : "")
      + (coverage.assurance_gap !== undefined ? ", and the assurance gap" : "")
      + ".",
  });
  if (payload.categories && payload.categories.length > 0) {
    items.push({ label: "By category", detail: `${plural(payload.categories.length, "area")}, each with its counts and whether a critical scenario failed.` });
  }
  items.push({ label: "Obligations", detail: `${plural(payload.obligations.length, "obligation")}, each with its counts.` });
  items.push({
    label: "Findings",
    detail: payload.findings.length === 0
      ? "None: no scenario failed or produced no result. Passed scenarios are counted above, not listed."
      : `${plural(payload.findings.length, "scenario")} that failed or produced no result, each with its severity, what was expected and what the graders observed. Passed scenarios are counted above, not listed, and no transcript is included.`,
  });
  if (payload.comparison) {
    items.push({ label: "Comparison", detail: `Against run ${payload.comparison.baseline_run}: what was fixed, still failing and newly failing.` });
  }
  if (run.manifest_hash) {
    items.push({
      label: "Inputs declared before the run",
      detail: `The SHA-256 of the run's manifest (${run.manifest_hash.slice(0, 12)}…): suite version and scenario ids in order, policy version, agent host, grading plan, rubric digest, runner version and pass mark, frozen before anything was sent. The digest is sealed here; the manifest itself is stored with the run.`,
    });
  }
  if (run.fingerprint && run.fingerprint.length > 0) {
    items.push({ label: "Target fingerprint", detail: `${plural(run.fingerprint.length, "item")} describing what was tested, each marked recorded by Novera, declared by the customer or not supplied.` });
  }
  if (run.previous_report_hash !== undefined) {
    items.push({
      label: "Chain",
      detail: run.previous_report_hash
        ? `The SHA-256 of the previous report for this agent (${run.previous_report_hash.slice(0, 12)}…), so the reports form a chain.`
        : "That this is the first report for this agent: there is no earlier report to chain to.",
    });
  }
  if (payload.human_review) items.push({ label: "Review", detail: "What the tested party's reviewers found, beside the verdicts and never in place of them." });
  if (payload.reissue) items.push({ label: "Reissue", detail: `The SHA-256 of the report this one reissues (${payload.reissue.of.slice(0, 12)}…), carried unchanged.` });
  items.push({ label: "Scope and limitations", detail: "The limitations text written into this report." });
  return items;
}

/** What a reader might assume is sealed and is not. */
export const SEAL_EXCLUDES: readonly string[] = [
  "Novera's standing notice (testing evidence, not certification), which is shown beside every report.",
  "When the report was sealed, when its link expires and whether it was withdrawn: these are stored beside it.",
  "The agent's replies, transcripts and each model's individual vote, which stay with the run.",
  "This page's layout, its print header and footer, and this dialog.",
];

/**
 * A Node one-liner that prints the SHA-256 of a JSON export's `payload`, canonicalised
 * exactly as `hash.ts` does: keys sorted, no whitespace, arrays in order. Tested against
 * `contentHash` in tests/seal.test.ts — a command that did not reproduce the seal would be
 * worse than none.
 */
export const VERIFY_SNIPPET =
  `const c=v=>v===null||typeof v!=="object"?JSON.stringify(v):Array.isArray(v)?"["+v.map(c)+"]":"{"+Object.keys(v).sort().map(k=>JSON.stringify(k)+":"+c(v[k]))+"}";`
  + `const p=JSON.parse(require("fs").readFileSync(0,"utf8")).payload;`
  + `console.log(require("crypto").createHash("sha256").update(c(p)).digest("hex"))`;

/** Fetch the export and hash it, while the link is live. */
export function verifyFromLink(exportUrl: string): string {
  return `curl -s '${exportUrl}' | node -e '${VERIFY_SNIPPET}'`;
}

/** Hash a JSON export already downloaded, with no network. */
export function verifyFromFile(fileName = "report.json"): string {
  return `node -e '${VERIFY_SNIPPET}' < ${fileName}`;
}
