import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { gradingFundedBy } from "../src/lib/report/build.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";
import {
  BUILT_IN_SUITES,
  buildReceipt,
  normaliseDigest,
  receiptJsonLd,
  receiptSuite,
  SEAL_COLUMNS,
  type SealRow,
} from "../src/lib/report/public-verify.ts";

/**
 * The public seal check (`/verify/<sha256>`). Its whole job is to answer "did Novera seal this,
 * and does it still hash?" while saying nothing a stranger holding a digest could not already
 * know. These tests hold both halves: the answer is computed from the stored payload, and the
 * receipt carries none of the report's private fields.
 */

const TOKEN = "P5CH7jRLd6wZA-TGHsDEY_5ZmSRU62Wb";
const CLIENT = "Acme Widgets GmbH";
const AGENT = "Acme refunds bot";

const FORMAT_1: ReportPayload = {
  novera: { format: 1 },
  subject: { client: CLIENT, agent: AGENT, policy_version: 3, environment: "Customer-operated agent", authorisation: "Attested by owner@acme.example" },
  run: { id: "8a4f2c1e-0000-4000-8000-000000000001", date: "2026-09-01", suite: "EU support agent conformity suite (eu-support v1)", graded_by: ["m-a"], graded_uniformly: true, grading_funded_by: "Novera trial allowance" },
  coverage: { planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0, score: 50, basis: "b" },
  obligations: [{ code: "identity_verification", covered: true, planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0 }],
  findings: [{ case: "T01", obligation: "identity_verification", severity: "high", expected: "verify identity", observed: "the agent replied to jane@customer.example", outcome: "fail" }],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

const PREVIOUS = "b".repeat(64);

const FORMAT_14: ReportPayload = {
  ...FORMAT_1,
  novera: { format: 14 },
  subject: { ...FORMAT_1.subject, environment: "Customer-operated agent, tested with recorded authorisation" },
  run: {
    ...FORMAT_1.run,
    date: "2026-10-13",
    suite: "EU support agent conformity suite (eu-support v5)",
    grading_funded_by: gradingFundedBy("workspace_key"),
    graders: [{ model: "m-a", role: "first", cases: 2 }, { model: "m-b", role: "second", cases: 2 }],
    pass_threshold: 80,
    duration_ms: 27_400,
    corroboration: { method: "consensus", agreed: 2, majority: 0, uncorroborated: 0, unresolved: 0, independent: 2, single_vendor: 0, settled_by_rule: 1 },
    manifest_hash: "a".repeat(64),
    previous_report_hash: PREVIOUS,
    fingerprint: [{ field: "agent_endpoint", value: "agent.acme.example", provenance: "recorded" }],
  },
  grade: { band: "B", score: 85, threshold: 80, basis: "b", meets_threshold: true },
};

function rowOf(payload: ReportPayload, extra: Partial<SealRow> = {}): SealRow {
  return { payload, content_hash: contentHash(payload as unknown as Json), created_at: "2026-10-13T09:41:12.345+00:00", revoked_at: null, ...extra };
}

// ---------------------------------------------------------------- the digest

test("a digest is 64 hex characters, normalised to lowercase", () => {
  const valid = "20c0a3783215a8b23c7a2e7d4a4fd5f91f04ee30256e5dba85317b766b7bb517";
  assert.equal(normaliseDigest(valid), valid);
  assert.equal(normaliseDigest(valid.toUpperCase()), valid);
  assert.equal(normaliseDigest(`  ${valid}\n`), valid);
  assert.equal(normaliseDigest(valid.slice(1)), null, "63 characters");
  assert.equal(normaliseDigest(`${valid}0`), null, "65 characters");
  assert.equal(normaliseDigest(`${valid.slice(1)}g`), null, "non-hex");
  assert.equal(normaliseDigest(""), null);
  assert.equal(normaliseDigest("not-a-hash"), null);
  assert.equal(normaliseDigest(undefined), null);
  assert.equal(normaliseDigest(["a".repeat(64)]), null);
});

test("the lookup reads four columns, none of them the token, workspace, run or withdrawer", () => {
  const columns = SEAL_COLUMNS.split(",").map((c) => c.trim());
  assert.deepEqual(columns, ["payload", "content_hash", "created_at", "revoked_at"]);
});

// ---------------------------------------------------------------- the receipt

test("an unknown digest is unknown, and says nothing else", () => {
  assert.deepEqual(buildReceipt("0".repeat(64), null), { state: "unknown", digest: "0".repeat(64) });
});

test("a format-1 report: verified, with every later field absent rather than defaulted", () => {
  const row = rowOf(FORMAT_1);
  const receipt = buildReceipt(row.content_hash, row);
  assert.equal(receipt.state, "verified");
  if (receipt.state !== "verified") return;
  const d = receipt.details;
  assert.equal(d.format, 1);
  assert.equal(d.sealedAt, "2026-10-13 09:41 UTC");
  assert.equal(d.runDate, "2026-09-01");
  assert.deepEqual(d.suite, { builtIn: true, name: "EU support agent conformity suite", key: "eu-support", version: 1 });
  assert.equal(d.fundedBy, "Novera trial allowance");
  assert.deepEqual(d.counts, { planned: 3, passed: 1, failed: 1, noResult: 1, notRun: 0 });
  assert.equal(d.grade, null, "format 1 records no grade");
  assert.deepEqual(d.chain, { kind: "not_recorded" }, "format 1 predates the chain");
  assert.equal(d.reissueOf, null);
  assert.equal(d.testData, false);
});

test("a format-14 report: verified, with its grade, funding and chain as sealed", () => {
  const row = rowOf(FORMAT_14);
  const receipt = buildReceipt(row.content_hash, row);
  assert.equal(receipt.state, "verified");
  if (receipt.state !== "verified") return;
  const d = receipt.details;
  assert.equal(d.format, 14);
  assert.equal(d.fundedBy, "customer-supplied model key");
  assert.deepEqual(d.grade, { band: "B", score: 85, shownAs: null, threshold: 80 });
  assert.deepEqual(d.chain, { kind: "previous", hash: PREVIOUS });
  assert.deepEqual(d.suite, { builtIn: true, name: "EU support agent conformity suite", key: "eu-support", version: 5 });
});

test("a first report says it starts the chain; a withheld grade shows no score", () => {
  const payload: ReportPayload = {
    ...FORMAT_14,
    run: { ...FORMAT_14.run, previous_report_hash: null },
    grade: { band: "WITHHELD", score: 40, threshold: 80, basis: "b", meets_threshold: null },
  };
  const row = rowOf(payload);
  const receipt = buildReceipt(row.content_hash, row);
  assert.equal(receipt.state, "verified");
  if (receipt.state !== "verified") return;
  assert.deepEqual(receipt.details.chain, { kind: "first" });
  assert.deepEqual(receipt.details.grade, { band: "WITHHELD", score: null, shownAs: "withheld", threshold: 80 });
});

test("every funding sentence gradingFundedBy writes is shown; anything else is not repeated", () => {
  // A grant-funded run (a pilot, 0067 `funded_by_grant`) has its own sentence, never "the plan".
  const sentences = [...(["trial_free", "workspace_key", "plan_managed"] as const).map((source) => gradingFundedBy(source)), gradingFundedBy("plan_managed", "grant")];
  assert.equal(new Set(sentences).size, 4);
  for (const sentence of sentences) {
    const payload: ReportPayload = { ...FORMAT_14, run: { ...FORMAT_14.run, grading_funded_by: sentence } };
    const row = rowOf(payload);
    const r = buildReceipt(row.content_hash, row);
    assert.equal(r.state === "verified" && r.details.fundedBy, sentence);
  }
  const odd: ReportPayload = { ...FORMAT_14, run: { ...FORMAT_14.run, grading_funded_by: "Novera Managed Consensus" } };
  const row = rowOf(odd);
  const r = buildReceipt(row.content_hash, row);
  assert.equal(r.state === "verified" && r.details.fundedBy, null);
});

test("a run against the scripted fixture is flagged as test data", () => {
  const payload: ReportPayload = { ...FORMAT_14, subject: { ...FORMAT_14.subject, environment: "Novera test fixture: scripted responses with planted failures, not a real agent" } };
  const row = rowOf(payload);
  const r = buildReceipt(row.content_hash, row);
  assert.equal(r.state === "verified" && r.details.testData, true);
});

test("a withdrawn report says withdrawn and when, and nothing more", () => {
  const row = rowOf(FORMAT_14, { revoked_at: "2026-10-12T17:05:00Z" });
  const receipt = buildReceipt(row.content_hash, row);
  assert.deepEqual(receipt, { state: "withdrawn", digest: row.content_hash, withdrawnAt: "2026-10-12 17:05 UTC" });
});

test("a stored payload that no longer hashes to its digest is a mismatch and shows nothing of it", () => {
  const row = rowOf(FORMAT_14);
  const edited = { ...row, payload: { ...FORMAT_14, coverage: { ...FORMAT_14.coverage, failed: 0, passed: 2 } } };
  const receipt = buildReceipt(row.content_hash, edited);
  assert.deepEqual(receipt, { state: "mismatch", digest: row.content_hash, sealedAt: "2026-10-13 09:41 UTC" });
  // The row stored under another digest than the one asked for is not a match either.
  assert.equal(buildReceipt("c".repeat(64), row).state, "mismatch");
  // Nor is a payload that is not an object at all.
  assert.equal(buildReceipt(row.content_hash, { ...row, payload: "x" }).state, "mismatch");
});

test("a workspace's own suite is named by its version only", () => {
  assert.deepEqual(receiptSuite("Acme refunds suite (acme-refunds v3)"), { builtIn: false, version: 3 });
  // A built-in key under another name is still the workspace's suite.
  assert.deepEqual(receiptSuite("Acme stuff (eu-support v5)"), { builtIn: false, version: 5 });
  assert.deepEqual(receiptSuite("something unreadable"), { builtIn: false, version: null });
  assert.deepEqual(receiptSuite(undefined), { builtIn: false, version: null });
});

test("the built-in suite names are the ones in data/suites", () => {
  const files = readdirSync("data/suites").filter((f) => /-v\d+\.json$/.test(f));
  const named = new Map<string, Set<string>>();
  for (const f of files) {
    const suite = JSON.parse(readFileSync(`data/suites/${f}`, "utf8")) as { key: string; name: string };
    named.set(suite.key, (named.get(suite.key) ?? new Set()).add(suite.name));
  }
  for (const [key, name] of Object.entries(BUILT_IN_SUITES)) {
    assert.ok(named.get(key)?.has(name), `${key} is not named "${name}" in data/suites`);
  }
});

// ---------------------------------------------------------------- what never leaves

const FORBIDDEN_KEYS = ["token", "client", "agent", "workspace_id", "workspace", "run_id", "id", "subject", "authorisation", "environment", "findings", "observed", "expected", "policy", "limitations", "revoked_by", "payload", "graders", "fingerprint", "manifest_hash"];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

test("no receipt carries a private field, in its keys or its text", () => {
  const verified = rowOf(FORMAT_14);
  const receipts = [
    buildReceipt(verified.content_hash, verified),
    buildReceipt(rowOf(FORMAT_1).content_hash, rowOf(FORMAT_1)),
    buildReceipt(verified.content_hash, { ...verified, revoked_at: "2026-10-12T17:05:00Z" }),
    buildReceipt(verified.content_hash, { ...verified, payload: { ...FORMAT_14, limitations: "edited" } }),
  ];
  for (const receipt of receipts) {
    const keys = keysOf(receipt);
    for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${receipt.state} receipt has key ${k}`);
    const text = JSON.stringify(receipt);
    for (const secret of [TOKEN, CLIENT, AGENT, "owner@acme.example", "jane@customer.example", "agent.acme.example", FORMAT_14.run.id, "a".repeat(64), "Customer-operated agent"]) {
      assert.ok(!text.includes(secret), `${receipt.state} receipt contains ${secret}`);
    }
  }
});

test("the structured data names the page and the product, and nothing about the report", () => {
  const digest = "d".repeat(64);
  const ld = receiptJsonLd(digest);
  assert.deepEqual(ld.map((x) => x["@type"]), ["ItemPage", "SoftwareApplication"]);
  assert.deepEqual(ld[0].isPartOf, { "@type": "WebSite", name: "Novera", url: "https://www.nover.space" });
  assert.equal(ld[0].url, `https://www.nover.space/verify/${digest}`);
  assert.equal(ld[1].applicationCategory, "BusinessApplication");
  const text = JSON.stringify(ld);
  assert.doesNotMatch(text, /offers|price|Organization/);
});

test("the receipt pages pass the customer-language rule", () => {
  for (const file of ["src/app/verify/page.tsx", "src/app/verify/[hash]/page.tsx", "src/app/verify/digest-form.tsx", "src/lib/report/public-verify.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.deepEqual(scanCustomerLanguage(source), [], file);
    assert.doesNotMatch(source, /tamper-proof|\bcompliant\b|\bcertified\b|\bconformant\b/i, file);
  }
});
