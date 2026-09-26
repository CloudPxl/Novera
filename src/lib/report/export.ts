import { obligationLabel, scoreWithheldAs, type ReportPayload } from "./payload.ts";
import { ciOutcome } from "./ci.ts";

/**
 * A sealed report, rendered as text.
 *
 * Two rules govern everything here, both inherited from the document itself:
 *
 *  1. **Nothing is computed.** Every number is read from the payload that was
 *     hashed. An export that recalculated a score could disagree with the sealed
 *     document it claims to be a copy of, and the whole value of the artifact is
 *     that the number cannot move after it is issued.
 *  2. **The limitations travel with it.** A CSV of failures, detached from the
 *     scope-and-limitations block, reads as a finished audit. Both formats carry
 *     it, and both carry the hash so any copy can be checked against the original.
 *
 * Format 1 payloads predate `grade` and `categories`. Every read of those is
 * optional here, because a report already in a client's hands must keep exporting.
 */

function escapeCsv(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvRows(rows: Array<Array<string | number | null | undefined>>): string {
  // CRLF and a UTF-8 BOM: Excel is the likeliest destination for this file, and it
  // mis-reads accented characters without them.
  return "﻿" + rows.map((r) => r.map(escapeCsv).join(",")).join("\r\n") + "\r\n";
}

export function reportToCsv(payload: ReportPayload, contentHash: string): string {
  const { subject, run, coverage, findings, limitations } = payload;
  const rows: Array<Array<string | number | null | undefined>> = [];

  rows.push(["Novera conformity report"]);
  rows.push(["Client", subject.client]);
  rows.push(["Agent", subject.agent]);
  rows.push(["Policy version", subject.policy_version]);
  rows.push(["Suite", run.suite]);
  rows.push(["Run date", run.date]);
  rows.push(["Run id", run.id]);
  rows.push(["Content hash (SHA-256)", contentHash]);
  if (payload.grade) {
    rows.push(["Grade", payload.grade.band]);
    rows.push(["Score", payload.grade.score ?? "not scored"]);
    rows.push(["Pass mark", payload.grade.threshold]);
    rows.push(["Basis", payload.grade.basis]);
  }
  rows.push([]);

  rows.push(["Coverage"]);
  rows.push(["Planned", "Graded", "Passed", "Failed", "Errored", "Not run", "Score"]);
  rows.push([
    coverage.planned, coverage.graded, coverage.passed,
    coverage.failed, coverage.errored, coverage.not_run,
    // A bare number, as before, so a spreadsheet still reads it as one.
    coverage.score === null ? "no score" : (scoreWithheldAs(payload) ?? coverage.score),
  ]);
  rows.push(["Basis", coverage.basis]);
  if (coverage.disputed !== undefined) rows.push(["Disputed (of which)", coverage.disputed]);
  // Absent before format 6; a null means it could not be computed, which is written
  // out rather than rendered as a number that was never measured.
  if (coverage.effect_confirmed !== undefined) {
    rows.push(["Actions confirmed by read-back", coverage.effect_confirmed]);
    rows.push(["Actions contradicted by read-back", coverage.effect_contradicted ?? 0]);
  }
  if (coverage.execution_coverage !== undefined) {
    rows.push(["Execution coverage (%)", coverage.execution_coverage]);
    rows.push(["Resolution coverage (%)", coverage.resolution_coverage ?? "not recorded"]);
    rows.push(["Evidence coverage (%)", coverage.evidence_coverage ?? "none required"]);
  }
  if (coverage.unverifiable !== undefined) rows.push(["Unverifiable (of which)", coverage.unverifiable]);
  if (coverage.assurance_gap !== undefined) {
    rows.push(["Assurance gap (% with no verdict)", coverage.assurance_gap]);
  }
  rows.push([]);

  if (payload.categories?.length) {
    rows.push(["By category"]);
    rows.push(["Category", "Planned", "Graded", "Passed", "Failed", "Errored", "Not run", "Score", "Critical failure"]);
    for (const c of payload.categories) {
      rows.push([
        c.category, c.planned, c.graded, c.passed, c.failed, c.errored, c.not_run,
        c.score ?? "no score", c.critical_failure ? "yes" : "no",
      ]);
    }
    rows.push([]);
  }

  rows.push(["Obligations"]);
  rows.push(["Obligation", "Covered", "Planned", "Graded", "Passed", "Failed", "Errored", "Not run"]);
  for (const o of payload.obligations) {
    rows.push([
      obligationLabel(o.code), o.covered ? "yes" : "no",
      o.planned, o.graded, o.passed, o.failed, o.errored, o.not_run,
    ]);
  }
  rows.push([]);

  rows.push(["Findings"]);
  rows.push(["Scenario", "Obligation", "Severity", "Outcome", "Expected", "Observed"]);
  for (const f of findings) {
    rows.push([
      f.case, obligationLabel(f.obligation), f.severity,
      f.outcome === "error" ? "no result" : f.outcome,
      f.expected, f.observed,
    ]);
  }
  rows.push([]);

  // Format 11, reissues only.
  if (payload.human_review) {
    const review = payload.human_review;
    rows.push(["Review by the tested party", review.note]);
    rows.push(["Reviewed by", review.reviewed_by]);
    rows.push(["Reviewed", "Agreed", "Disagreed", "Finding with no automated result"]);
    rows.push([review.reviewed, review.agreed, review.disagreed, review.resolved_gaps]);
    rows.push(["Their reading — not a score", "Passed", "Failed", "Without a result"]);
    rows.push(["", review.with_findings_applied.passed, review.with_findings_applied.failed, review.with_findings_applied.no_verdict]);
    rows.push(["Scenario", "Automated verdict", "Reviewer's finding", "Reason", "Reviewed at"]);
    for (const f of review.findings) {
      rows.push([f.case_id, f.verdict === "error" ? "no result" : f.verdict, f.finding, f.note, f.reviewed_at]);
    }
    rows.push([]);
  }
  if (payload.reissue) {
    rows.push(["Reissues report", payload.reissue.of]);
    rows.push([]);
  }

  // Never dropped. A list of failures without its scope reads as a finished audit.
  rows.push(["Scope and limitations", limitations]);

  return csvRows(rows);
}

export function reportToMarkdown(payload: ReportPayload, contentHash: string, url: string): string {
  const { subject, run, coverage, findings, comparison, limitations } = payload;
  const out: string[] = [];

  out.push(`# Agent evaluation report — ${subject.agent}`);
  out.push("");
  out.push(`**Client:** ${subject.client}  `);
  out.push(`**Agent:** ${subject.agent}  `);
  out.push(`**Policy version:** v${subject.policy_version}  `);
  out.push(`**Suite:** ${run.suite}  `);
  out.push(`**Run date:** ${run.date}  `);
  out.push(`**Authorisation:** ${subject.authorisation}`);
  out.push("");

  if (payload.grade) {
    const g = payload.grade;
    out.push(`## Grade: ${g.band}${g.score === null ? "" : ` (${g.score}%)`}`);
    out.push("");
    out.push(g.basis);
    out.push("");
  }

  out.push("## Coverage");
  out.push("");
  out.push("| Planned | Graded | Passed | Failed | No result | Not run | Score |");
  out.push("| ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  out.push(
    `| ${coverage.planned} | ${coverage.graded} | ${coverage.passed} | ${coverage.failed} | ` +
    `${coverage.errored} | ${coverage.not_run} | ${coverage.score === null ? "no score" : (scoreWithheldAs(payload) ?? `${coverage.score}%`)} |`,
  );
  out.push("");
  out.push(coverage.basis);
  if (coverage.assurance_gap !== undefined && coverage.assurance_gap > 0) {
    out.push("");
    out.push(`**${coverage.assurance_gap}% of this evaluation produced no verdict.**`);
  }
  if (coverage.disputed !== undefined && coverage.disputed > 0) {
    out.push("");
    out.push(
      `${coverage.disputed} scenario(s) produced no verdict because two models disagreed ` +
      "and a third could not settle it. Novera records that rather than picking a side.",
    );
  }
  if (coverage.effect_confirmed !== undefined && (coverage.effect_confirmed > 0 || (coverage.effect_contradicted ?? 0) > 0)) {
    out.push("");
    out.push(
      `${coverage.effect_confirmed} scenario(s) had the action they describe confirmed by reading your own system. ` +
      `${coverage.effect_contradicted ?? 0} described an action your system does not show.`,
    );
  }
  if (coverage.execution_coverage !== undefined) {
    out.push("");
    out.push(
      `Executed ${coverage.execution_coverage}% of the scenarios in scope. ` +
      `Reasoned ${coverage.resolution_coverage === null ? "not recorded" : `${coverage.resolution_coverage}%`} ` +
      "of the requirements they carry. " +
      (coverage.evidence_coverage === null
        ? "No scenario required proof beyond the agent's words."
        : `Evidenced ${coverage.evidence_coverage}% of the scenarios that asked for proof beyond the agent's words.`),
    );
  }
  if (coverage.unverifiable !== undefined && coverage.unverifiable > 0) {
    out.push("");
    out.push(
      `${coverage.unverifiable} scenario(s) expected an action and nothing independent of the ` +
      "agent evidenced that it happened, so the pass was withheld.",
    );
  }
  out.push("");

  if (payload.categories?.length) {
    out.push("## By category");
    out.push("");
    out.push("| Category | Passed | Graded | Score | Critical failure |");
    out.push("| --- | ---: | ---: | ---: | --- |");
    for (const c of payload.categories) {
      out.push(
        `| ${c.category} | ${c.passed} | ${c.graded} | ` +
        `${c.score === null ? "no score" : `${c.score}%`} | ${c.critical_failure ? "yes" : "no"} |`,
      );
    }
    out.push("");
  }

  out.push("## How verdicts were reached");
  out.push("");
  if (run.corroboration) {
    const c = run.corroboration;
    // `method` is a sentence that already ends in a full stop in some payloads and
    // not in others, so it is normalised rather than concatenated blindly.
    out.push(
      `${c.method.replace(/\.\s*$/, "")}. ` +
      `${c.agreed} agreed, ${c.majority} settled by a third model, ` +
      `${c.uncorroborated} could not be corroborated, ${c.unresolved} could not be resolved.`,
    );
    // Absent before format 4; an older report says nothing here rather than gaining
    // a claim about evidence nobody examined at the time it was sealed.
    if (c.settled_by_rule !== undefined && c.settled_by_rule > 0) {
      out.push("");
      out.push(
        `${c.settled_by_rule} scenario(s) were settled by a rule stated in the scenario, with no model asked.`,
      );
    }
    if (c.independent !== undefined) {
      out.push("");
      out.push(
        c.single_vendor
          ? `${c.independent} verdict(s) were corroborated across vendors and ${c.single_vendor} within one vendor.`
          : `All ${c.independent} corroborated verdict(s) were confirmed across vendors.`,
      );
    }
  } else {
    out.push(
      "This report was sealed before Novera recorded corroboration, so each verdict came " +
      "from a single model.",
    );
  }
  out.push("");
  out.push(`Graded by: ${run.graded_by.join(", ")}. Grading funded by ${run.grading_funded_by}.`);
  // Absent before format 7 and on runs that predate the manifest; nothing is printed
  // rather than a line implying the inputs were sealed when they were not.
  if (run.manifest_hash) {
    out.push("");
    out.push(
      "The scenarios, policy version, grading models and pass mark were recorded before " +
      `this run executed, sealed as \`${run.manifest_hash}\`.`,
    );
  }
  if (payload.reissue) {
    out.push("");
    out.push(`Reissues an earlier report for the same run, to disclose review, digest \`${payload.reissue.of}\`.`);
  }
  if (run.previous_report_hash) {
    out.push("");
    out.push(`Follows an earlier report for the same agent, digest \`${run.previous_report_hash}\`.`);
  }
  out.push("");

  out.push("## Obligations");
  out.push("");
  out.push("| Obligation | Covered | Passed | Graded |");
  out.push("| --- | --- | ---: | ---: |");
  for (const o of payload.obligations) {
    out.push(`| ${obligationLabel(o.code)} | ${o.covered ? "yes" : "no"} | ${o.passed} | ${o.graded} |`);
  }
  out.push("");

  out.push("## Findings");
  out.push("");
  if (findings.length === 0) {
    out.push("No scenario failed or errored.");
  } else {
    for (const f of findings) {
      out.push(`### ${f.case} — ${obligationLabel(f.obligation)} (${f.severity})`);
      out.push("");
      out.push(`**Outcome:** ${f.outcome === "error" ? "no result" : f.outcome}`);
      out.push("");
      out.push(`**Expected:** ${f.expected}`);
      out.push("");
      out.push(`**Observed:** ${f.observed}`);
      out.push("");
    }
  }

  if (comparison) {
    out.push("## Compared with the previous run");
    out.push("");
    out.push(comparison.note);
    out.push("");
    out.push(`- Fixed: ${comparison.fixed.join(", ") || "none"}`);
    out.push(`- Still failing: ${comparison.persistent_failures.join(", ") || "none"}`);
    out.push(`- Newly broken: ${comparison.new_failures.join(", ") || "none"}`);
    out.push(`- No result this time: ${comparison.now_errored.join(", ") || "none"}`);
    // Format 10 only. An older report made no claim about stability, so the export
    // makes none either rather than printing an "unstable: none" it never measured.
    if (comparison.unstable && comparison.unstable.length > 0) {
      out.push(
        `- Moved before under an unchanged policy: ${comparison.unstable
          .map((u) => `${u.case_id} (passed ${u.passes}, failed ${u.fails} of ${u.runs})`)
          .join(", ")} — not, on its own, evidence about this change`,
      );
    }
    out.push("");
  }

  // Format 11, and only on a reissue. Nothing is printed for a report that made no
  // statement about review.
  const review = payload.human_review;
  if (review) {
    const applied = review.with_findings_applied;
    out.push("## Review by the tested party");
    out.push("");
    out.push(review.note);
    out.push("");
    out.push(`- Reviewed by: ${review.reviewed_by}`);
    out.push(`- Verdicts reviewed: ${review.reviewed} — agreed with ${review.agreed}, disagreed with ${review.disagreed}`
      + (review.resolved_gaps > 0 ? `, finding on ${review.resolved_gaps} with no automated result` : ""));
    out.push(`- Their reading: ${applied.passed} passed, ${applied.failed} failed`
      + (applied.no_verdict > 0 ? `, ${applied.no_verdict} without a result` : "")
      + " if their findings replaced the verdicts they dispute. Not a score.");
    out.push(`- As of: ${review.as_of.slice(0, 16).replace("T", " ")} UTC`);
    out.push("");
    for (const f of review.findings) {
      out.push(`**${f.case_id}** — ${f.verdict === "error" ? "no automated result" : `graded ${f.verdict}`}; the reviewer found it ${f.finding}. ${f.note}`);
      out.push("");
    }
  }

  out.push("## Scope and limitations");
  out.push("");
  out.push(limitations);
  out.push("");

  out.push("---");
  out.push("");
  out.push(`Content hash (SHA-256): \`${contentHash}\``);
  out.push("");
  out.push(`Original: ${url}`);
  out.push("");

  return out.join("\n");
}

/**
 * The sealed payload itself, for a machine: the exact object that was hashed, the
 * hash, and how to recompute it — so a copy can be checked by someone who trusts
 * neither Novera nor whoever forwarded the file. `ci` is a reading of the sealed
 * counts, outside the payload, and is not part of what the hash covers.
 */
export const JSON_EXPORT_VERSION = 1;

export function reportToJson(payload: ReportPayload, contentHash: string, url: string): string {
  return JSON.stringify(
    {
      novera_export: JSON_EXPORT_VERSION,
      url,
      content_hash: contentHash,
      hash: {
        algorithm: "SHA-256",
        over: "payload",
        canonicalisation: "UTF-8 JSON, object keys sorted, no whitespace, array order kept",
      },
      ci: ciOutcome(payload),
      payload,
    },
    null,
    2,
  ) + "\n";
}

function escapeXml(value: string | number): string {
  return String(value)
    // Characters XML 1.0 cannot carry at all; a model's rationale can contain them.
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * JUnit XML, for the test reporters every CI system already has.
 *
 * One `<testsuite>` per obligation, its counts copied from the payload. A sealed report
 * names only the scenarios that failed or produced no result, so those are individual
 * test cases; the passed scenarios are one case that says how many, because inventing
 * ids for them would be exactly the backfilled result this product refuses to print.
 * "No result" is a JUnit *error*, never a failure and never a pass; "not run" is
 * *skipped*. The limitations and the hash travel as properties.
 */
/**
 * A report link with its token cut to four characters. The token is the access to the
 * report, and a JUnit file is a CI artifact — often uploaded, sometimes public. The
 * content hash identifies the report without granting access to it.
 */
export function withoutToken(url: string): string {
  return url.replace(/(\/report\/[A-Za-z0-9_-]{4})[A-Za-z0-9_-]+/, "$1…");
}

export function reportToJunit(payload: ReportPayload, contentHash: string, url: string): string {
  const { subject, run, coverage, findings } = payload;
  const ci = ciOutcome(payload);
  const a = (name: string, value: string | number) => `${name}="${escapeXml(value)}"`;
  const seconds = typeof run.duration_ms === "number" ? (run.duration_ms / 1000).toFixed(3) : "0";
  const out: string[] = [];

  out.push('<?xml version="1.0" encoding="UTF-8"?>');
  out.push(
    `<testsuites ${a("name", `Novera: ${subject.agent} — ${run.suite}`)} ${a("tests", coverage.planned)} ` +
    `${a("failures", coverage.failed)} ${a("errors", coverage.errored)} ${a("skipped", coverage.not_run)} ` +
    `${a("time", seconds)} ${a("timestamp", run.date)}>`,
  );

  const property = (name: string, value: string | number) => `      <property ${a("name", name)} ${a("value", value)}/>`;
  const properties = [
    property("novera.report", withoutToken(url)),
    property("novera.content_hash", contentHash),
    property("novera.policy_version", subject.policy_version),
    property("novera.environment", subject.environment),
    property("novera.grade", payload.grade?.band ?? "not graded"),
    property("novera.ci_exit_code", ci.code),
    property("novera.ci_reason", ci.reason),
    property("novera.limitations", payload.limitations),
  ];

  const byObligation = new Map<string, typeof findings>();
  for (const f of findings) byObligation.set(f.obligation, [...(byObligation.get(f.obligation) ?? []), f]);
  const groups = payload.obligations.map((o) => ({
    code: o.code, tests: o.planned, failures: o.failed, errors: o.errored, skipped: o.not_run, passed: o.passed,
  }));
  // A finding whose obligation the payload does not list still has to appear somewhere.
  for (const code of byObligation.keys()) {
    if (!groups.some((g) => g.code === code)) {
      const list = byObligation.get(code)!;
      const failures = list.filter((f) => f.outcome === "fail").length;
      groups.push({ code, tests: list.length, failures, errors: list.length - failures, skipped: 0, passed: 0 });
    }
  }

  groups.forEach((g, i) => {
    const classname = `novera.${g.code}`;
    out.push(
      `  <testsuite ${a("name", obligationLabel(g.code))} ${a("tests", g.tests)} ${a("failures", g.failures)} ` +
      `${a("errors", g.errors)} ${a("skipped", g.skipped)} ${a("timestamp", run.date)}>`,
    );
    if (i === 0) {
      out.push("    <properties>");
      out.push(...properties);
      out.push("    </properties>");
    }
    for (const f of byObligation.get(g.code) ?? []) {
      const tag = f.outcome === "fail" ? "failure" : "error";
      const message = f.outcome === "fail" ? `Failed (${f.severity})` : `No result (${f.severity})`;
      out.push(`    <testcase ${a("classname", classname)} ${a("name", f.case)}>`);
      out.push(`      <${tag} ${a("message", message)} ${a("type", f.severity)}>${escapeXml(`Expected: ${f.expected}\nObserved: ${f.observed}`)}</${tag}>`);
      out.push("    </testcase>");
    }
    if (g.passed > 0) {
      out.push(`    <testcase ${a("classname", classname)} ${a("name", `${g.passed} scenario${g.passed === 1 ? "" : "s"} passed (listed by count in the sealed report)`)}/>`);
    }
    if (g.skipped > 0) {
      out.push(`    <testcase ${a("classname", classname)} ${a("name", `${g.skipped} scenario${g.skipped === 1 ? "" : "s"} not run`)}>`);
      out.push(`      <skipped ${a("message", "Not run: no verdict, and not counted as a pass.")}/>`);
      out.push("    </testcase>");
    }
    out.push("  </testsuite>");
  });

  if (groups.length === 0) {
    out.push(`  <testsuite ${a("name", "Novera report")} tests="0" failures="0" errors="0" skipped="0">`);
    out.push("    <properties>");
    out.push(...properties);
    out.push("    </properties>");
    out.push("  </testsuite>");
  }
  out.push("</testsuites>");
  return out.join("\n") + "\n";
}
