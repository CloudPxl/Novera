import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { webcrypto } from "node:crypto";
import { canonicalise as canonicaliseNode, contentHash, type Json } from "../src/lib/report/hash.ts";
import { canonicalise, contentHashWeb, normaliseDigest } from "../src/lib/report/canonical.ts";
import {
  fileVerdict,
  ledgerPath,
  MAX_REPORT_FILE_BYTES,
  readLedgerAnswer,
  readReportFile,
  type LedgerAnswer,
} from "../src/lib/report/file-check.ts";
import { verifyAnswer, VERIFY_ANSWER_CACHE } from "../src/lib/report/verify-answer.ts";
import { buildReceipt, type SealReceipt, type SealRow } from "../src/lib/report/public-verify.ts";
import { reportToJson } from "../src/lib/report/export.ts";
import { VERIFY_SNIPPET } from "../src/lib/report/seal.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

/**
 * The file check on `/verify` hashes a report in the reader's browser. It is worth something
 * only if it computes the seal's exact bytes, so the canonical form is held byte for byte
 * against a frozen copy of the original `hash.ts` and against the seal inspector's snippet,
 * and its Web Crypto digest against `contentHash`. The JSON answer it asks is held to the
 * receipt's privacy rule.
 */

// The canonicaliser exactly as hash.ts shipped it before it moved to canonical.ts. Frozen here:
// if the shared one ever changes, every sealed report stops verifying, and this fails first.
function frozenCanonicalise(value: Json): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(frozenCanonicalise).join(",")}]`;
  const keys = Object.keys(value).sort();
  const body = keys
    .filter((k) => value[k] !== undefined)
    .map((k) => `${JSON.stringify(k)}:${frozenCanonicalise(value[k])}`)
    .join(",");
  return `{${body}}`;
}

// The seal inspector's `c`, the independent one-liner a reader runs in Node.
const snippetCanonicalise = new Function(`${VERIFY_SNIPPET.slice(0, VERIFY_SNIPPET.indexOf(";const p="))};return c;`)() as (v: unknown) => string;

const TOKEN = "P5CH7jRLd6wZA-TGHsDEY_5ZmSRU62Wb";
const CLIENT = "Café Ünïcode — “quotes” GmbH";
const AGENT = "Agent 🤖 refunds";
const RUN_ID = "8a4f2c1e-0000-4000-8000-000000000001";
const WORKSPACE_ID = "3c1d9e00-0000-4000-8000-0000000000ff";

const FORMAT_1: ReportPayload = {
  novera: { format: 1 },
  subject: { client: CLIENT, agent: AGENT, policy_version: 3, environment: "Customer-operated agent", authorisation: "Attested by owner@acme.example" },
  run: { id: RUN_ID, date: "2026-10-13", suite: "EU support agent conformity suite (eu-support v5)", graded_by: ["m-a"], graded_uniformly: true, grading_funded_by: "Novera trial allowance" },
  coverage: { planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0, score: 66.7, basis: "Line\nbreak\ttab \u0001 \u007f     😀 é ﻿" },
  obligations: [{ code: "identity_verification", covered: true, planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0 }],
  findings: [{ case: "T01", obligation: "identity_verification", severity: "high", expected: "e", observed: "o \\ \"x\" </script> jane@customer.example", outcome: "fail" }],
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
    fingerprint: [{ field: "agent_endpoint", value: "agent.acme.example", provenance: "recorded" }],
  },
  grade: { band: "WITHHELD", score: 0.1 + 0.2, threshold: 80, basis: "b", meets_threshold: null },
  categories: [{ category: "identity", planned: 3, graded: 2, passed: 1, failed: 1, errored: 1, not_run: 0, score: 1e-7, critical_failure: true }],
};

// Shapes a payload never has today but JSON can carry: the canonical form must still agree.
const AWKWARD: Json = {
  "10": 1, "2": 2, b: [3, { z: null, a: [] }], a: {}, "é": "\u0000\u001f", "😀": -0,
  floats: [0.1 + 0.2, 1e21, 1e-7, 5e-324, 1.7976931348623157e308, -1.5, 100, 2 ** 53 + 2],
  lone: "\ud800", nested: [[[["deep"]]]], bools: [true, false], empty: "",
};

const FIXTURES: Array<[string, Json]> = [
  ["format 1", FORMAT_1 as unknown as Json],
  ["format 14", FORMAT_14 as unknown as Json],
  ["awkward JSON", AWKWARD],
];

const subtle = webcrypto.subtle;

// ---------------------------------------------------------------- the canonical form

for (const [name, payload] of FIXTURES) {
  test(`the browser canonicaliser is byte-identical to the seal's (${name})`, async () => {
    const shared = canonicalise(payload);
    assert.equal(shared, frozenCanonicalise(payload));
    assert.equal(shared, canonicaliseNode(payload));
    assert.equal(shared, snippetCanonicalise(payload));
    // What the browser holds is the JSON export parsed back, never the server's object.
    const parsed = JSON.parse(JSON.stringify(payload)) as Json;
    assert.equal(canonicalise(parsed), shared);
    assert.deepEqual(Buffer.from(new TextEncoder().encode(shared)), Buffer.from(shared, "utf8"));
  });

  test(`Web Crypto over the canonical form equals contentHash (${name})`, async () => {
    assert.equal(await contentHashWeb(payload, subtle), contentHash(payload));
  });
}

test("hash.ts still exports the one canonicaliser, and a known payload seals to a digest computed outside it", async () => {
  assert.equal(canonicaliseNode, canonicalise);
  assert.equal(canonicalise({ b: [2, 1], a: "x" }), '{"a":"x","b":[2,1]}');
  assert.equal(await contentHashWeb({ b: [2, 1], a: "x" }, subtle), "1bb141b0beaf4ebf42280d226d19296aa9bcde08525419393fa8c706e6a57148");
  // Pinned from `printf '{"a":"x","b":[2,1]}' | shasum -a 256`, outside any of our code.
  assert.equal(contentHash({ b: [2, 1], a: "x" }), "1bb141b0beaf4ebf42280d226d19296aa9bcde08525419393fa8c706e6a57148");
});

// ---------------------------------------------------------------- reading the file

function exportOf(payload: ReportPayload): { text: string; digest: string } {
  const digest = contentHash(payload as unknown as Json);
  return { text: reportToJson(payload, digest, `https://example.test/report/${TOKEN}`), digest };
}

async function digestOfText(text: string): Promise<string> {
  const read = readReportFile(text);
  assert.ok(read.ok && read.shape !== "none", "the file was not read as a report");
  return contentHashWeb(read.payload, subtle);
}

for (const payload of [FORMAT_1, FORMAT_14]) {
  test(`a JSON export and its bare payload both reproduce the seal (format ${payload.novera.format})`, async () => {
    const { text, digest } = exportOf(payload);
    const read = readReportFile(text);
    assert.ok(read.ok && read.shape === "export");
    assert.equal(read.claimed, digest);
    assert.equal(read.claimedUnreadable, false);
    assert.equal(await digestOfText(text), digest);

    const bare = JSON.stringify(payload, null, 2);
    const readBare = readReportFile(bare);
    assert.ok(readBare.ok && readBare.shape === "payload");
    assert.equal(readBare.claimed, null);
    assert.equal(await digestOfText(bare), digest);
    // A byte-order mark from an editor is not content.
    assert.equal(await digestOfText(`﻿${text}`), digest);
  });
}

test("a tampered field changes the digest; the export's unsealed wrapper does not", async () => {
  const { text, digest } = exportOf(FORMAT_14);
  const parsed = JSON.parse(text);

  const tampered = structuredClone(parsed);
  tampered.payload.coverage.passed = 3;
  const tamperedDigest = await digestOfText(JSON.stringify(tampered));
  assert.notEqual(tamperedDigest, digest);
  assert.equal((readReportFile(JSON.stringify(tampered)) as { claimed: string }).claimed, digest);

  const reordered = structuredClone(parsed);
  reordered.payload.findings[0].observed += " ";
  assert.notEqual(await digestOfText(JSON.stringify(reordered)), digest);

  const wrapper = structuredClone(parsed);
  wrapper.notice.text = "edited";
  wrapper.ci = { outcome: "pass" };
  wrapper.url = "https://elsewhere.example/";
  assert.equal(await digestOfText(JSON.stringify(wrapper)), digest);
  // Whitespace and key order in the file are not content either.
  assert.equal(await digestOfText(JSON.stringify(parsed)), digest);
});

test("malformed, empty, oversize and contentless files are refused before anything is looked up", () => {
  assert.deepEqual(readReportFile("{ not json"), { ok: false, problem: "not_json" });
  assert.deepEqual(readReportFile("# Markdown report\n"), { ok: false, problem: "not_json" });
  assert.deepEqual(readReportFile(""), { ok: false, problem: "empty" });
  assert.deepEqual(readReportFile("  \n"), { ok: false, problem: "empty" });
  assert.deepEqual(readReportFile("{}", MAX_REPORT_FILE_BYTES + 1), { ok: false, problem: "too_large" });
  assert.equal(MAX_REPORT_FILE_BYTES, 5 * 1024 * 1024);
  const big = JSON.stringify({ pad: "x".repeat(MAX_REPORT_FILE_BYTES) });
  assert.deepEqual(readReportFile(big), { ok: false, problem: "too_large" });
  // Multi-byte text is measured in bytes, not characters.
  const wide = JSON.stringify({ pad: "é".repeat(MAX_REPORT_FILE_BYTES / 2 + 10) });
  assert.deepEqual(readReportFile(wide), { ok: false, problem: "too_large" });

  for (const text of ["[1,2]", "42", '"x"', "null", '{"novera_export":1,"payload":"nope"}', '{"content_hash":"x","payload":[1]}']) {
    assert.deepEqual(readReportFile(text), { ok: true, shape: "none" }, text);
  }
});

test("an export whose stated digest is unreadable says so, and is still hashed", async () => {
  const { text, digest } = exportOf(FORMAT_1);
  const parsed = JSON.parse(text);
  parsed.content_hash = "not-a-digest";
  const read = readReportFile(JSON.stringify(parsed));
  assert.ok(read.ok && read.shape === "export");
  assert.equal(read.claimed, null);
  assert.equal(read.claimedUnreadable, true);
  assert.equal(await contentHashWeb(read.payload, subtle), digest);
  // An uppercase stated digest is the same digest.
  parsed.content_hash = digest.toUpperCase();
  assert.equal((readReportFile(JSON.stringify(parsed)) as { claimed: string }).claimed, digest);
});

test("a random JSON object is hashed as it is and found in no ledger", async () => {
  const read = readReportFile('{"hello":"world","n":[1,2,3]}');
  assert.ok(read.ok && read.shape === "payload");
  const computed = await contentHashWeb(read.payload, subtle);
  assert.equal(fileVerdict({ computed, claimed: null, ledger: { state: "unknown", digest: computed }, claimedLedger: null }), "not_sealed");
});

// ---------------------------------------------------------------- the verdict

const C = "c".repeat(64);
const S = "5".repeat(64);
const verified = (digest: string): LedgerAnswer => buildReceipt(digest, rowFor(FORMAT_14, digest)) as SealReceipt;
const unknown = (digest: string): LedgerAnswer => ({ state: "unknown", digest });
const unavailable = (digest: string): LedgerAnswer => ({ state: "unavailable", digest });

function rowFor(payload: ReportPayload, digest = contentHash(payload as unknown as Json), extra: Partial<SealRow> = {}): SealRow {
  // A row stored under a digest that is not its payload's reads as a mismatch.
  return { payload, content_hash: digest, created_at: "2026-10-13T09:41:12Z", revoked_at: null, ...extra };
}

test("the verdict follows the computed digest first, and says changed only over a sealed stated digest", () => {
  const real = contentHash(FORMAT_14 as unknown as Json);
  const sealed = verified(real);
  assert.equal(sealed.state, "verified");
  assert.equal(fileVerdict({ computed: real, claimed: real, ledger: sealed, claimedLedger: null }), "matches");
  assert.equal(fileVerdict({ computed: real, claimed: null, ledger: sealed, claimedLedger: null }), "matches");
  // The stated digest is outside the seal: content that hashes to a sealed report matches it.
  assert.equal(fileVerdict({ computed: real, claimed: S, ledger: sealed, claimedLedger: null }), "matches");

  assert.equal(fileVerdict({ computed: C, claimed: real, ledger: unknown(C), claimedLedger: sealed }), "changed");
  assert.equal(fileVerdict({ computed: C, claimed: real, ledger: unknown(C), claimedLedger: { state: "withdrawn", digest: real, withdrawnAt: null } }), "changed");
  assert.equal(fileVerdict({ computed: C, claimed: S, ledger: unknown(C), claimedLedger: unknown(S) }), "not_sealed");
  assert.equal(fileVerdict({ computed: C, claimed: C, ledger: unknown(C), claimedLedger: null }), "not_sealed");
  assert.equal(fileVerdict({ computed: C, claimed: null, ledger: unknown(C), claimedLedger: null }), "not_sealed");

  assert.equal(fileVerdict({ computed: C, claimed: C, ledger: { state: "withdrawn", digest: C, withdrawnAt: "2026-10-14 08:00 UTC" }, claimedLedger: null }), "withdrawn");
  assert.equal(fileVerdict({ computed: C, claimed: C, ledger: { state: "mismatch", digest: C, sealedAt: null }, claimedLedger: null }), "stored_mismatch");

  // A read that failed concludes nothing, on either digest.
  assert.equal(fileVerdict({ computed: C, claimed: null, ledger: unavailable(C), claimedLedger: null }), "unavailable");
  assert.equal(fileVerdict({ computed: C, claimed: S, ledger: unknown(C), claimedLedger: unavailable(S) }), "unavailable");
  assert.equal(fileVerdict({ computed: C, claimed: S, ledger: unknown(C), claimedLedger: null }), "unavailable");
});

test("an answer that is not the receipt for the asked digest is read as unavailable", () => {
  assert.equal(readLedgerAnswer(C, { state: "unknown", digest: C }).state, "unknown");
  assert.equal(readLedgerAnswer(C, { state: "unknown", digest: S }).state, "unavailable");
  assert.equal(readLedgerAnswer(C, { state: "verified", digest: C }).state, "unavailable");
  assert.equal(readLedgerAnswer(C, { state: "malformed" }).state, "unavailable");
  assert.equal(readLedgerAnswer(C, null).state, "unavailable");
  assert.equal(readLedgerAnswer(C, "<html>").state, "unavailable");
  assert.equal(ledgerPath(C), `/api/verify/${C}`);
});

// ---------------------------------------------------------------- the JSON endpoint

const FORBIDDEN_KEYS = ["token", "client", "agent", "workspace_id", "workspace", "run_id", "id", "subject", "authorisation", "environment", "findings", "observed", "expected", "policy", "limitations", "revoked_by", "payload", "graders", "fingerprint", "manifest_hash"];
const FORBIDDEN_TEXT = [TOKEN, CLIENT, AGENT, RUN_ID, WORKSPACE_ID, "owner@acme.example", "jane@customer.example", "agent.acme.example", "a".repeat(64), "Customer-operated agent"];

function keysOf(value: unknown, into = new Set<string>()): Set<string> {
  if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      into.add(k);
      keysOf(v, into);
    }
  }
  return into;
}

// A lookup that hands back what the database row would hold, with extra columns it must never
// pass on, to prove the answer is the receipt's allow-list and not the row.
function fakeLookup(rows: Record<string, SealRow>, asked: string[]) {
  return async (digest: string) => {
    asked.push(digest);
    const row = rows[digest];
    return buildReceipt(digest, row ? ({ ...row, token: TOKEN, workspace_id: WORKSPACE_ID, run_id: RUN_ID } as SealRow) : null);
  };
}

test("the JSON answer carries none of the report's private fields, in any state", async () => {
  const real14 = contentHash(FORMAT_14 as unknown as Json);
  const real1 = contentHash(FORMAT_1 as unknown as Json);
  const rows: Record<string, SealRow> = {
    [real14]: rowFor(FORMAT_14),
    [real1]: rowFor(FORMAT_1, real1, { revoked_at: "2026-10-14T08:00:00Z" }),
    [C]: rowFor(FORMAT_14, C),
  };
  const asked: string[] = [];
  const lookup = fakeLookup(rows, asked);
  const states: string[] = [];
  for (const digest of [real14, real1, C, S]) {
    const response = await verifyAnswer(digest, lookup);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("cache-control"), VERIFY_ANSWER_CACHE);
    assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
    assert.equal(response.headers.get("x-robots-tag"), "noindex, nofollow");
    const text = await response.text();
    const body = JSON.parse(text);
    states.push(body.state);
    assert.equal(body.digest, digest);
    const keys = keysOf(body);
    for (const k of FORBIDDEN_KEYS) assert.ok(!keys.has(k), `${body.state} answer has key ${k}`);
    for (const secret of FORBIDDEN_TEXT) assert.ok(!text.includes(secret), `${body.state} answer contains ${secret}`);
  }
  assert.deepEqual(states, ["verified", "withdrawn", "mismatch", "unknown"]);
  assert.deepEqual(asked, [real14, real1, C, S]);
});

test("the JSON answer: 400 for a malformed digest without a lookup, 503 when the ledger cannot be read, one address per digest", async () => {
  const asked: string[] = [];
  const lookup = fakeLookup({}, asked);
  for (const bad of ["abc", "g".repeat(64), "c".repeat(65), "", "%zz", "../../etc"]) {
    const response = await verifyAnswer(bad, lookup);
    assert.equal(response.status, 400, bad);
    assert.equal(response.headers.get("cache-control"), "no-store");
    assert.equal((await response.json()).state, "malformed");
  }
  assert.deepEqual(asked, []);

  const upper = await verifyAnswer(C.toUpperCase(), lookup);
  assert.equal(upper.status, 200);
  assert.equal((await upper.json()).digest, C);
  assert.deepEqual(asked, [C]);

  const down = await verifyAnswer(C, async () => "unavailable");
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("cache-control"), "no-store");
  assert.deepEqual(await down.json(), { state: "unavailable", digest: C });
  assert.equal(normaliseDigest(C.toUpperCase()), C);
});

// ---------------------------------------------------------------- what leaves the browser

test("the browser side sends only a digest, by GET, without cookies, and loads no Node code", () => {
  const client = readFileSync("src/app/verify/file-check.tsx", "utf8");
  assert.match(client, /^"use client";/);
  const fetches = client.match(/\bfetch\(/g) ?? [];
  assert.equal(fetches.length, 1, "one fetch call");
  assert.match(client, /fetch\(ledgerPath\(digest\), \{\s*method: "GET",\s*credentials: "omit",/);
  assert.doesNotMatch(client, /\bbody:|XMLHttpRequest|sendBeacon|FormData|WebSocket|localStorage|sessionStorage/);
  for (const file of ["src/app/verify/file-check.tsx", "src/lib/report/canonical.ts", "src/lib/report/file-check.ts", "src/app/verify/receipt-details.tsx"]) {
    const source = readFileSync(file, "utf8");
    assert.doesNotMatch(source, /from "node:|from "@\/lib\/report\/hash|from "\.\/hash|server-only|supabase/, file);
    // Only types cross from the server modules.
    for (const line of source.split("\n").filter((l) => /public-verify/.test(l) && /^import /.test(l))) {
      assert.match(line, /^import type /, `${file}: ${line}`);
    }
  }
});

test("the file check's words pass the customer-language rule", () => {
  for (const file of ["src/app/verify/file-check.tsx", "src/app/verify/receipt-details.tsx", "src/lib/report/file-check.ts", "src/lib/report/verify-answer.ts"]) {
    const source = readFileSync(file, "utf8");
    assert.deepEqual(scanCustomerLanguage(source), [], file);
    assert.doesNotMatch(source, /tamper-proof|\bcompliant\b|\bcertified\b|\bconformant\b/i, file);
  }
  const client = readFileSync("src/app/verify/file-check.tsx", "utf8");
  assert.match(client, /The file never leaves your browser; only its SHA-256 is sent to look it up/);
  assert.match(client, /REPORT_NOTICE_SHORT/);
});
