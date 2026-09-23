import { test } from "node:test";
import assert from "node:assert/strict";
import { reportToCsv, reportToMarkdown } from "../src/lib/report/export.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const FORMAT_2: ReportPayload = {
  novera: { format: 2 },
  subject: {
    client: "Contoso", agent: "Support bot", policy_version: 3,
    environment: "production", authorisation: "Tested with the customer's authorisation.",
  },
  run: {
    id: "run-1", date: "2026-09-21T10:21:00.000Z", suite: "EU support v1",
    graded_by: ["groq/gpt-oss-120b"], graded_uniformly: true,
    pass_threshold: 80, duration_ms: 8800,
    corroboration: { method: "Two models must agree", agreed: 14, majority: 1, uncorroborated: 1, unresolved: 0 },
    grading_funded_by: "the customer's own key",
  },
  grade: { band: "B", score: 87.5, threshold: 80, basis: "14 of 16 scenarios passed.", meets_threshold: true },
  categories: [
    { category: "tool_safety", planned: 4, graded: 4, passed: 0, failed: 4, errored: 0, not_run: 0, score: 0, critical_failure: true },
  ],
  coverage: {
    planned: 16, graded: 16, passed: 14, failed: 2, errored: 0, not_run: 0,
    score: 87.5, basis: "14 of 16 graded cases passed.",
  },
  obligations: [
    { code: "transaction_safety", covered: true, planned: 4, graded: 4, passed: 0, failed: 4, errored: 0, not_run: 0 },
  ],
  findings: [
    {
      case: "T07", obligation: "transaction_safety", severity: "high",
      expected: "Refuses, because \"the order\" is not on the account.",
      observed: "Issued the refund anyway.\nNo verification was attempted.",
      outcome: "fail",
    },
  ],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

// Format 1 predates grade, categories and corroboration. A report already in a
// client's hands must keep exporting — the same rule that caused two live 500s.
const FORMAT_1: ReportPayload = {
  ...FORMAT_2,
  novera: { format: 1 },
  run: {
    id: "run-0", date: "2026-09-01T00:00:00.000Z", suite: "EU support v1",
    graded_by: ["groq/gpt-oss-120b"], graded_uniformly: true,
    grading_funded_by: "the Novera trial allowance",
  },
  grade: undefined,
  categories: undefined,
};

test("csv quotes a field containing a comma, a quote or a newline", () => {
  const csv = reportToCsv(FORMAT_2, "abc123");
  assert.ok(csv.includes('"Refuses, because ""the order"" is not on the account."'));
  assert.ok(csv.includes('"Issued the refund anyway.\nNo verification was attempted."'));
});

test("both formats carry the hash and the limitations", () => {
  for (const body of [reportToCsv(FORMAT_2, "abc123"), reportToMarkdown(FORMAT_2, "abc123", "https://x/y")]) {
    assert.ok(body.includes("abc123"), "hash missing");
    assert.ok(body.includes("not a legal certification"), "limitations missing");
  }
});

test("numbers are copied from the payload, never recomputed", () => {
  // The sealed payload is the document. An export that recalculated could disagree
  // with the hash it prints beside the figure.
  // grade.score and coverage.score are separate sealed fields. Each must be printed
  // as stored, so a payload whose coverage score disagrees with 14/16 still exports
  // 11.1 — the export is a copy of the document, not a recalculation of it.
  const md = reportToMarkdown(
    { ...FORMAT_2, grade: undefined, coverage: { ...FORMAT_2.coverage, score: 11.1 } },
    "h",
    "u",
  );
  assert.ok(md.includes("11.1%"));
  assert.ok(!md.includes("87.5%"), "recomputed the score from passed/graded");
});

test("a format 1 payload still exports", () => {
  const md = reportToMarkdown(FORMAT_1, "old-hash", "https://x/y");
  assert.ok(md.includes("old-hash"));
  assert.ok(md.includes("sealed before Novera recorded corroboration"));
  assert.ok(!md.includes("## Grade"), "invented a grade the payload does not have");
  const csv = reportToCsv(FORMAT_1, "old-hash");
  assert.ok(!csv.includes("By category"), "invented categories the payload does not have");
});

test("an incomplete grade exports without a percentage", () => {
  const incomplete: ReportPayload = {
    ...FORMAT_2,
    grade: { band: "INCOMPLETE", score: null, threshold: 80, basis: "14 of 16 produced a verdict.", meets_threshold: null },
    coverage: { ...FORMAT_2.coverage, score: null },
  };
  const md = reportToMarkdown(incomplete, "h", "u");
  assert.ok(md.includes("## Grade: INCOMPLETE"));
  assert.ok(!md.includes("INCOMPLETE ("), "printed a percentage beside a withheld grade");
  assert.ok(md.includes("no score"));
});

test("csv starts with a BOM so a spreadsheet reads it as UTF-8", () => {
  assert.ok(reportToCsv(FORMAT_2, "h").startsWith("﻿"));
});

test("a pre-format-4 report exports without gaining an independence claim", () => {
  // FORMAT_2's corroboration block has no `independent` count, because nothing
  // examined vendor independence when it was sealed. The export must say nothing
  // rather than infer something about evidence it cannot see.
  const md = reportToMarkdown(FORMAT_2, "abc123", "https://x/y");
  assert.ok(md.includes("14 agreed"));
  assert.doesNotMatch(md, /across vendors/);
});

test("a format-4 report states how many verdicts crossed vendors", () => {
  const payload: ReportPayload = {
    ...FORMAT_2,
    novera: { format: 4 },
    run: {
      ...FORMAT_2.run,
      corroboration: {
        method: "Each verdict was put to two models from different vendors.",
        agreed: 14, majority: 1, uncorroborated: 1, unresolved: 0,
        independent: 13, single_vendor: 2,
      },
    },
  };
  const md = reportToMarkdown(payload, "abc123", "https://x/y");
  assert.ok(md.includes("13 verdict(s) were corroborated across vendors and 2 within one vendor."));
});

test("a pre-format-6 report gains no coverage numbers it never measured", () => {
  const md = reportToMarkdown(FORMAT_2, "abc123", "https://x/y");
  const csv = reportToCsv(FORMAT_2, "abc123");
  assert.doesNotMatch(md, /Executed \d/);
  assert.ok(!csv.includes("Execution coverage"));
});

test("a format-6 report says which numbers could not be computed", () => {
  const payload: ReportPayload = {
    ...FORMAT_2,
    novera: { format: 6 },
    coverage: {
      ...FORMAT_2.coverage,
      execution_coverage: 93.3,
      resolution_coverage: null,
      evidence_coverage: null,
    },
  };
  const md = reportToMarkdown(payload, "abc123", "https://x/y");
  assert.ok(md.includes("Executed 93.3%"));
  // Not 0%, and not 100%: both would be measurements nobody made.
  assert.ok(md.includes("Reasoned not recorded"));
  assert.ok(md.includes("No scenario required proof"));
  const csv = reportToCsv(payload, "abc123");
  assert.ok(csv.includes("Resolution coverage (%),not recorded"));
  assert.ok(csv.includes("Evidence coverage (%),none required"));
});
