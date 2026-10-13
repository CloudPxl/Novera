import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { reportToJson } from "../src/lib/report/export.ts";
import { sealContents, SEAL_ATTRIBUTION, SEAL_EXCLUDES, VERIFY_SNIPPET, verifyFromFile } from "../src/lib/report/seal.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

/**
 * The seal inspector prints a command and says it reproduces the report's SHA-256. These
 * tests run that exact command against JSON exports and compare with `contentHash`, so the
 * dialog can never show a command that does not reproduce the seal.
 */

const FORMAT_1: ReportPayload = {
  novera: { format: 1 },
  subject: { client: "Café Ünïcode — “quotes”", agent: "Agent 🤖", policy_version: 3, environment: "Customer-operated agent", authorisation: "Attested by a@b.c" },
  run: { id: "r1", date: "2026-10-13", suite: "eu-support (eu-support v5)", graded_by: ["m-a"], graded_uniformly: true, grading_funded_by: "trial" },
  coverage: { planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0, score: 66.7, basis: "Line\nbreak\ttab \u0001 \u007f  " },
  obligations: [{ code: "identity_verification", covered: true, planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0 }],
  findings: [{ case: "T01", obligation: "identity_verification", severity: "high", expected: "e", observed: "o \\ \"x\"", outcome: "fail" }],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

const FORMAT_14: ReportPayload = {
  ...FORMAT_1,
  novera: { format: 14 },
  run: {
    ...FORMAT_1.run,
    graders: [{ model: "m-a", role: "first", cases: 2 }, { model: "m-b", role: "second", cases: 2 }],
    pass_threshold: 80,
    duration_ms: 27_400,
    corroboration: { method: "consensus", agreed: 2, majority: 0, uncorroborated: 0, unresolved: 0, independent: 2, single_vendor: 0, settled_by_rule: 1 },
    manifest_hash: "a".repeat(64),
    previous_report_hash: null,
    fingerprint: [{ field: "agent_endpoint", value: "agent.example.com", provenance: "recorded" }],
  },
  grade: { band: "WITHHELD", score: 0.1 + 0.2, threshold: 80, basis: "b", meets_threshold: null },
  categories: [{ category: "identity", planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0, score: 1e-7, critical_failure: true }],
};

for (const payload of [FORMAT_1, FORMAT_14]) {
  test(`the inspector's command reproduces the seal (format ${payload.novera.format})`, () => {
    const expected = contentHash(payload as unknown as Json);
    const exported = reportToJson(payload, expected, "https://example.test/report/x");
    const printed = execFileSync(process.execPath, ["-e", VERIFY_SNIPPET], { input: exported, encoding: "utf8" }).trim();
    assert.equal(printed, expected);
  });
}

test("the file form is the same snippet, reading the file on stdin", () => {
  assert.equal(verifyFromFile("r.json"), `node -e '${VERIFY_SNIPPET}' < r.json`);
  // Single-quoted in a shell: the snippet must not contain one.
  assert.ok(!VERIFY_SNIPPET.includes("'"));
});

test("a format-1 report is not described as carrying fields added later", () => {
  const labels = sealContents(FORMAT_1).map((i) => i.label);
  for (const later of ["Pass mark", "Corroboration", "Grade", "By category", "Inputs declared before the run", "Target fingerprint", "Chain", "Review", "Reissue"]) {
    assert.ok(!labels.includes(later), `format 1 claims ${later}`);
  }
  assert.match(sealContents(FORMAT_1).find((i) => i.label === "Graders")!.detail, /does not list second opinions/);
});

test("a format-14 report names what it does carry, and a first report says it starts the chain", () => {
  const items = sealContents(FORMAT_14);
  const labels = items.map((i) => i.label);
  for (const present of ["Pass mark", "Corroboration", "Grade", "By category", "Inputs declared before the run", "Target fingerprint", "Chain"]) {
    assert.ok(labels.includes(present), `format 14 omits ${present}`);
  }
  assert.match(items.find((i) => i.label === "Chain")!.detail, /first report/);
});

test("the seal's words pass the customer-language rule", () => {
  const text = [SEAL_ATTRIBUTION, ...SEAL_EXCLUDES, ...sealContents(FORMAT_14).map((i) => `${i.label}: ${i.detail}`)].join("\n");
  assert.deepEqual(scanCustomerLanguage(text), []);
  assert.doesNotMatch(text, /tamper-proof|compliance engine/i);
});
