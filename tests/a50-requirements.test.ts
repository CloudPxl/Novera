import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { contentHash, type Json } from "../src/lib/report/hash.ts";
import { coverage, coverageByObligation, coverageByCategory } from "../src/lib/evidence/coverage.ts";
import { mappedVersions, parseSourcesRegistration, sourcesFor, sourcesRegistryProblems, SOURCE_LAYERS } from "../src/lib/suites/sources.ts";
import { reportToCsv, reportToJunit, reportToMarkdown } from "../src/lib/report/export.ts";
import { clientSummary } from "../src/lib/report/client-summary.ts";
import { sealContents } from "../src/lib/report/seal.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { obligationLabel, type ReportPayload } from "../src/lib/report/payload.ts";
import {
  REQUIREMENTS_NOTE, REQUIREMENT_LAYERS, REQUIREMENT_LAYER_DESCRIPTIONS, REQUIREMENT_LAYER_LABELS,
  groupStatusSentence, requirementOutcomeWord, requirementsSummaryLines,
} from "../src/lib/report/requirements.ts";
import type { RunCaseRecord, SuiteCase } from "../src/lib/runner/types.ts";

/**
 * The Article 50 pack's requirements matrix (2026-11-05): the sources sidecar registry, its
 * frozen copy in a format-16 report, and every surface that renders it. Expectations are read
 * from the files on disk, never restated.
 */

const DIR = "data/suites";
const read = (file: string) => JSON.parse(readFileSync(`${DIR}/${file}`, "utf8"));
const SUITE = read("eu-ai-transparency-v1.json") as { key: string; version: number; name: string; cases: SuiteCase[] };
const SOURCES = read("eu-ai-transparency-v1.sources.json");
const HASH = "f".repeat(64);

function record(c: SuiteCase, over: Partial<RunCaseRecord> = {}): RunCaseRecord {
  return {
    runId: "run-a50", caseId: c.id, category: c.category, obligation: c.obligation, severity: c.severity,
    input: c.input, expected: c.expected_behavior, assertions: c.assertions,
    responseText: "I'm an automated assistant.", toolActivity: null, status: "pass",
    rationale: "Said it is an AI system in the first reply.", latencyMs: 80, usage: null,
    judgeModel: "groq/model-a", judgeAttempts: [],
    judgeVotes: [{ model: "groq/model-a", status: "pass" }, { model: "mistral/model-b", status: "pass" }],
    judgeAgreement: "agreed", failedAssertions: [], evidenceGap: null, settledBy: "models", observation: null,
    error: null, ...over,
  } as RunCaseRecord;
}

const allPass = () => SUITE.cases.map((c) => record(c));
const withRow = (id: string, over: Partial<RunCaseRecord>) => SUITE.cases.map((c) => record(c, c.id === id ? over : {}));

function input(cases: RunCaseRecord[], over: Partial<ReportInput> = {}): ReportInput {
  const planned: Record<string, number> = {};
  for (const c of SUITE.cases) planned[c.obligation] = (planned[c.obligation] ?? 0) + 1;
  return {
    client: "Northwind", agentName: "Support bot", policyVersion: 3, runId: "run-a50", runDate: "2026-11-05",
    environment: "Customer-operated agent", suite: { key: SUITE.key, version: SUITE.version, name: SUITE.name },
    attestation: "Owner attested.", judge: { source: "trial_free" }, cases,
    coverage: coverage({ plannedCases: SUITE.cases.length, cases }),
    byObligation: coverageByObligation(cases, planned),
    byCategory: coverageByCategory(cases, { transparency: SUITE.cases.length }),
    passThreshold: 80, durationMs: 1000, ...over,
  };
}

const sealed = (cases: RunCaseRecord[], over: Partial<ReportInput> = {}) => {
  const built = buildReport(input(cases, over));
  return { payload: built.payload as unknown as ReportPayload, hash: built.contentHash };
};

/* ---------------------------------------------------------------- registry */

test("every *.sources.json on disk is registered, valid and matched to its suite file", () => {
  assert.deepEqual(sourcesRegistryProblems(), []);
  const files = readdirSync(DIR).filter((f) => f.endsWith(".sources.json"));
  assert.ok(files.length >= 1);
  for (const file of files) {
    const s = read(file);
    const hit = mappedVersions().find((m) => m.sources.suite === s.suite && m.sources.version === s.version);
    assert.ok(hit, `${file} is not registered in src/lib/suites/sources.ts`);
    const suiteFile = `${s.suite}-v${s.version}.json`;
    assert.deepEqual(parseSourcesRegistration({ sources: s, suite: read(suiteFile) }).problems, [], file);
  }
  assert.ok(sourcesFor("eu-ai-transparency", 1));
  assert.equal(sourcesFor("eu-ai-transparency", 2), null, "no fallback to another version");
  assert.equal(sourcesFor("eu-support", 7), null);
});

test("a sidecar naming an unknown layer, an unknown scenario or nothing at all is refused", () => {
  const clone = () => JSON.parse(JSON.stringify(SOURCES));
  const problems = (s: unknown, suite: unknown = SUITE) => parseSourcesRegistration({ sources: s, suite }).problems;

  const badLayer = clone();
  badLayer.cases.AT01.sources[0].layer = "case_law";
  assert.match(problems(badLayer).join("\n"), /AT01: source 1 has layer "case_law", which is not one of/);

  const unknownCase = clone();
  unknownCase.cases.AT99 = { sources: [{ layer: "binding_legislation", ref: "x" }], scope_limit: "x" };
  assert.match(problems(unknownCase).join("\n"), /AT99: not a scenario of eu-ai-transparency v1/);

  const unknownInGroup = clone();
  unknownInGroup.groups[0].cases.push("T01");
  assert.match(problems(unknownInGroup).join("\n"), /T01 is not a scenario/);

  const unmapped = clone();
  delete unmapped.cases.AT08;
  assert.match(problems(unmapped).join("\n"), /AT08 has no sources/);

  const empty = clone();
  empty.boundary = "  ";
  empty.cases.AT02.scope_limit = "";
  empty.not_evaluated[0].sources[0].ref = "";
  const text = problems(empty).join("\n");
  assert.match(text, /`boundary` must be a non-empty string/);
  assert.match(text, /AT02: `scope_limit`/);
  assert.match(text, /content_marking: source 1 needs a non-empty `ref`/);

  assert.match(problems(clone(), { ...SUITE, version: 2 }).join("\n"), /not eu-ai-transparency v1/);
  assert.equal(parseSourcesRegistration({ sources: badLayer, suite: SUITE }).mapped, null, "a whole mapping or none");
  // The five layers the sidecar contract names, and the renderer labels each.
  assert.deepEqual([...SOURCE_LAYERS], [...REQUIREMENT_LAYERS]);
});

/* -------------------------------------------------------------------- build */

test("format 16: every scenario observed → the group reads present, rows and texts frozen from the sidecar", () => {
  const { payload } = sealed(allPass());
  assert.equal(payload.novera.format, 16);
  const req = payload.requirements!;
  assert.ok(req);
  assert.equal(req.as_of, SOURCES.as_of);
  assert.equal(req.boundary, SOURCES.boundary);
  assert.equal(req.note, REQUIREMENTS_NOTE);
  assert.equal(req.voluntary_code, SOURCES.voluntary_code);
  assert.equal(req.customer_policy, `${SOURCES.customer_policy} The run was given policy version 3.`);
  assert.deepEqual(req.rows.map((r) => r.case), SUITE.cases.map((c) => c.id));
  assert.ok(req.rows.every((r) => r.outcome === "pass" && r.uncorroborated === false));
  for (const r of req.rows) {
    assert.deepEqual(r.sources, SOURCES.cases[r.case].sources);
    assert.equal(r.scope_limit, SOURCES.cases[r.case].scope_limit);
    assert.equal(r.obligation, SUITE.cases.find((c) => c.id === r.case)!.obligation);
  }
  assert.deepEqual(req.groups, [{
    id: "interaction_disclosure", label: SOURCES.groups[0].label, refs: SOURCES.groups[0].refs,
    status: "observed_present", passed: 8, failed: 0, no_result: 0, not_run: 0, uncorroborated_passes: 0,
  }]);
  assert.deepEqual(req.not_evaluated, SOURCES.not_evaluated);
  assert.equal(groupStatusSentence(req.groups[0]), "Observed interaction disclosure (AI Act Art. 50(1) and 50(5)): present in every tested conversation (8 of 8).");
});

test("one failure → deficient, whatever else is missing", () => {
  const cases = withRow("AT03", { status: "fail", rationale: "Gave a person's name and office." });
  cases.splice(cases.findIndex((c) => c.caseId === "AT05"), 1); // AT05 never recorded
  const req = sealed(cases).payload.requirements!;
  assert.equal(req.rows.find((r) => r.case === "AT03")!.outcome, "fail");
  assert.equal(req.rows.find((r) => r.case === "AT05")!.outcome, "not_run");
  assert.equal(req.groups[0].status, "observed_deficient");
  assert.match(groupStatusSentence(req.groups[0]), /: deficient in 1 of 8 conversations \(1 not run\)\.$/);
});

test("one scenario without a verdict → inconclusive; an error never sent is not run", () => {
  const cases = withRow("AT02", { status: "error", responseText: null, rationale: null, error: "Agent returned HTTP 502", judgeAgreement: null, judgeVotes: [] });
  const req = sealed(cases).payload.requirements!;
  assert.equal(req.rows.find((r) => r.case === "AT02")!.outcome, "no_result");
  assert.equal(req.groups[0].status, "inconclusive");
  assert.equal(req.groups[0].no_result, 1);
  assert.match(groupStatusSentence(req.groups[0]), /inconclusive \(1 without a verdict\)\.$/);

  const unsent = withRow("AT05", { status: "error", responseText: null, rationale: null, error: "This scenario is a conversation, and this agent's request template has no {{history}} slot.", judgeAgreement: null, judgeVotes: [] });
  const r2 = sealed(unsent).payload.requirements!;
  assert.equal(r2.rows.find((r) => r.case === "AT05")!.outcome, "not_run");
  assert.equal(r2.groups[0].not_run, 1);
  assert.equal(r2.groups[0].status, "inconclusive");
});

test("a pass resting on one model keeps its row a pass, and the group reads inconclusive and says why (G5)", () => {
  const cases = withRow("AT04", { judgeAgreement: "unconfirmed", judgeVotes: [{ model: "groq/model-a", status: "pass" }] });
  const { payload } = sealed(cases);
  const req = payload.requirements!;
  const row = req.rows.find((r) => r.case === "AT04")!;
  assert.equal(row.outcome, "pass");
  assert.equal(row.uncorroborated, true);
  assert.equal(req.groups[0].passed, 8);
  assert.equal(req.groups[0].uncorroborated_passes, payload.run.corroboration!.uncorroborated_passes);
  assert.equal(req.groups[0].status, "inconclusive");
  assert.match(groupStatusSentence(req.groups[0]), /inconclusive \(1 pass rests on one model's verdict, with no second model to corroborate it\)/);
  assert.equal(requirementOutcomeWord(row), "Observed (one model's verdict, not corroborated)");
});

test("no matrix for a suite without a sidecar, or for a reused key whose scenarios are not the mapped ones", () => {
  const other = SUITE.cases.map((c) => record(c, { obligation: "policy_accuracy" }));
  const eu = sealed(allPass(), { suite: { key: "eu-support", version: 7, name: "EU support" } }).payload;
  assert.equal(eu.novera.format, 16);
  assert.equal("requirements" in eu, false);
  assert.equal("requirements" in sealed(other).payload, false, "same ids, other obligations");
  const changed = withRow("AT01", { expected: "Something else entirely." });
  assert.equal("requirements" in sealed(changed).payload, false, "same ids, another definition");
  const extra = [...allPass(), record({ ...SUITE.cases[0], id: "W01" })];
  assert.equal("requirements" in sealed(extra).payload, false, "a scenario the mapping does not name");
});

test("an extension of the suite carries the matrix for the official scenarios only", () => {
  const cases = [...allPass(), record({ ...SUITE.cases[0], id: "W01", obligation: "policy_accuracy" }, { status: "fail" })];
  const { payload } = sealed(cases, {
    suite: { key: "eu-ai-transparency-v1-ext", version: 1, name: "Transparency + 1" },
    extension: { base_suite: "eu-ai-transparency v1", base_suite_digest: "a".repeat(64), scenarios: 1, extension_digest: "b".repeat(64) },
  });
  assert.deepEqual(payload.requirements!.rows.map((r) => r.case), SUITE.cases.map((c) => c.id));
  assert.equal(payload.requirements!.groups[0].status, "observed_present");
});

/* ---------------------------------------------------------- old documents */

// A format-15 payload as sealed before this change, frozen with its digest. Adding format 16
// must not move a byte of what an older report renders or hashes.
const FORMAT_15 = {
  novera: { format: 15 },
  subject: { client: "Acme", agent: "Bot", policy_version: 2, environment: "Customer-operated agent", authorisation: "Attested." },
  run: { id: "r15", date: "2026-10-30", suite: "EU support (eu-support v7)", graded_by: ["m-a"], graded_uniformly: true, grading_funded_by: "Novera trial allowance",
    graders: [{ model: "m-a", role: "first", cases: 2 }], pass_threshold: 80, duration_ms: 1000,
    corroboration: { method: "m.", agreed: 2, majority: 0, uncorroborated: 0, uncorroborated_passes: 0, unresolved: 0, independent: 2, single_vendor: 0, settled_by_rule: 0 },
    manifest_hash: null, previous_report_hash: null },
  grade: { band: "A", score: 100, threshold: 80, basis: "2 of 2.", meets_threshold: true },
  categories: [],
  coverage: { planned: 2, graded: 2, passed: 2, failed: 0, errored: 0, not_run: 0, score: 100, basis: "2 of 2." },
  obligations: [{ code: "ai_disclosure", covered: true, planned: 2, graded: 2, passed: 2, failed: 0, errored: 0, not_run: 0 }],
  findings: [],
  comparison: null,
  limitations: "Evidence of testing, not a certification.",
} as unknown as ReportPayload;

const sha = (text: string) => createHash("sha256").update(text).digest("hex");

test("an older payload hashes as sealed and renders byte for byte as before, with no matrix anywhere", () => {
  // Through storage and back: nothing in the payload's own seal depends on this change.
  assert.equal(contentHash(JSON.parse(JSON.stringify(FORMAT_15)) as Json), contentHash(FORMAT_15 as unknown as Json));
  const md = reportToMarkdown(FORMAT_15, HASH, "https://www.nover.space/report/tok");
  const csv = reportToCsv(FORMAT_15, HASH);
  // Digests of the exports as the code before format 16 rendered this payload (export.ts at
  // ec2bccb, compared output for output when format 16 landed).
  assert.equal(sha(reportToMarkdown(FORMAT_15, "a".repeat(64), "https://www.nover.space/report/tok")), "ddac95e0eb444a464a17e27952f659abf4fbec2ec3060af931dd631e568f7946");
  assert.equal(sha(reportToCsv(FORMAT_15, "a".repeat(64))), "b033d9e4f7a12b85cbb9a82884cc0b3ee7d2831326f265a18c1a44917f07c30f");
  const junit = reportToJunit(FORMAT_15, HASH, "https://www.nover.space/report/tok");
  const summary = clientSummary({ payload: FORMAT_15, contentHash: HASH, origin: "https://www.nover.space" });
  for (const text of [md, csv, junit, summary]) assert.doesNotMatch(text, /Requirements matrix|NOT EVALUATED|requirements_as_of|Not evaluated:/);
  assert.ok(!sealContents(FORMAT_15).some((i) => i.label === "Requirements matrix"));
  assert.deepEqual(requirementsSummaryLines(undefined), []);
});

/* ----------------------------------------------------------------- renders */

test("Markdown: boundary first, every row, the not-evaluated block, and outside text escaped", () => {
  const { payload } = sealed(withRow("AT03", { status: "fail" }));
  const md = reportToMarkdown(payload, HASH, "https://www.nover.space/report/tok");
  const section = md.slice(md.indexOf("## Requirements matrix"), md.indexOf("## Scope and limitations"));
  assert.ok(section.startsWith("## Requirements matrix\n\n> **Boundary.** This report describes"));
  for (const c of SUITE.cases) assert.match(section, new RegExp(`\\| ${c.id} \\| ${obligationLabel(c.obligation).replace(/[()']/g, ".")} \\|`));
  assert.match(section, /\| AT03 \| Never presented as a person \| Not observed \|/);
  assert.match(section, /### Not evaluated/);
  assert.match(section, /\*\*NOT EVALUATED: Machine-readable marking of AI-generated content \(AI Act Art\. 50\(2\)\)\.\*\*/);
  for (const layer of REQUIREMENT_LAYERS) assert.ok(section.includes(`**${REQUIREMENT_LAYER_LABELS[layer]}:**`));
  assert.match(md, /## Scope and limitations[\s\S]*\*\*Requirements matrix boundary\.\*\* This report describes/);

  // A hostile sealed string renders as its words, not as markup.
  const hostile = structuredClone(payload);
  hostile.requirements!.rows[0].scope_limit = "x\n\n## Grade: A (100%) | [link](https://evil.example) <img src=x>";
  hostile.requirements!.boundary = "# Compliant";
  const out = reportToMarkdown(hostile, HASH, "u");
  assert.doesNotMatch(out, /\n## Grade: A/);
  assert.match(out, /\\#\\# Grade: A \(100%\) \\\| \\\[link\\\]\(https:\/\/evil\.example\) \\<img src=x\\>/);
  assert.match(out, /> \*\*Boundary\.\*\* \\# Compliant/);
});

test("CSV: one row per scenario with its sources by layer, and NOT EVALUATED rows", () => {
  const { payload } = sealed(allPass());
  const csv = reportToCsv(payload, HASH);
  assert.match(csv, /\r\nRequirements matrix\r\n/);
  assert.match(csv, /Scenario,Obligation,Observed outcome,Binding legislation,Commission guidance,Voluntary code,Customer policy,Novera scenario,"Scope limit, or why not evaluated"/);
  for (const c of SUITE.cases) assert.match(csv, new RegExp(`\\r\\n${c.id},[^\\r\\n]*,Observed,"?Regulation \\(EU\\) 2024/1689`));
  assert.match(csv, /\r\nMachine-readable marking of AI-generated content,AI Act Art\. 50\(2\),NOT EVALUATED,/);
  assert.match(csv, /Requirements matrix boundary,/);
  const junit = reportToJunit(payload, HASH, "https://www.nover.space/report/tok");
  assert.match(junit, /<property name="novera\.requirements_as_of" value="2026-11-05"\/>/);
});

test("client summary: one line per group, one per item not evaluated, and the boundary's first sentence", () => {
  const { payload, hash } = sealed(withRow("AT04", { judgeAgreement: "unconfirmed" }));
  const text = clientSummary({ payload, contentHash: hash, origin: "https://www.nover.space" });
  assert.match(text, /^Observed interaction disclosure \(AI Act Art\. 50\(1\) and 50\(5\)\): inconclusive \(1 pass rests on one model's verdict/m);
  assert.match(text, /^Not evaluated: Machine-readable marking of AI-generated content \(AI Act Art\. 50\(2\)\) — Marking under Article 50\(2\) is machine-readable: a watermark, metadata or a provenance record, checked with the provider's own detection tool or by inspecting the content's files\.$/m);
  assert.match(text, /^This report describes the agent's behaviour in the conversations Novera sent it\.$/m);
  assert.ok(sealContents(payload).some((i) => i.label === "Requirements matrix"));
});

test("no rendered matrix copy claims compliance, certification or a guarantee", () => {
  const variants = [
    sealed(allPass()).payload,
    sealed(withRow("AT03", { status: "fail" })).payload,
    sealed(withRow("AT02", { status: "error", error: "Agent returned HTTP 502" })).payload,
    sealed(withRow("AT04", { judgeAgreement: "unconfirmed" })).payload,
  ];
  for (const payload of variants) {
    const texts = [
      reportToMarkdown(payload, HASH, "u"),
      reportToCsv(payload, HASH),
      clientSummary({ payload, contentHash: HASH, origin: "https://www.nover.space" }),
      ...payload.requirements!.groups.map(groupStatusSentence),
      ...payload.requirements!.rows.map(requirementOutcomeWord),
    ];
    for (const text of texts) assert.deepEqual(scanCustomerLanguage(text), [], text.slice(0, 120));
    for (const g of payload.requirements!.groups) assert.doesNotMatch(groupStatusSentence(g), /compliant|passed Article 50|conform/i);
  }
  for (const text of [REQUIREMENTS_NOTE, ...Object.values(REQUIREMENT_LAYER_DESCRIPTIONS)]) assert.deepEqual(scanCustomerLanguage(text), [], text);
  // The page's own fixed sentences, read from its source.
  const page = readFileSync("src/app/report/[token]/page.tsx", "utf8");
  const section = page.slice(page.indexOf("function RequirementsMatrix"), page.indexOf("function ObligationStatus"));
  assert.ok(section.length > 0);
  assert.deepEqual(scanCustomerLanguage(section), []);
  assert.match(section, /role="region" aria-label="Requirements matrix table"/);
  assert.match(section, /tabIndex=\{0\}/);
  assert.doesNotMatch(section, /\b(?:bg|text|border|ring)-(?:red|green|amber|yellow|orange|blue|slate|gray|zinc|emerald|rose|sky)-\d{2,3}\b/, "design tokens only");
});
