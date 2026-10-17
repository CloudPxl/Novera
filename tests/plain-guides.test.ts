import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  buildReportGuide, guideFactsFromPayload, guideFactsFromRun, guideText, READING_A_REPORT_HREF, PLAIN_WORDS_HREF,
} from "../src/lib/explainability/report-guide.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { parseDocBody } from "../src/lib/docs/markdown.ts";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { coverage, coverageByCategory, coverageByObligation } from "../src/lib/evidence/coverage.ts";
import { gradeRun } from "../src/lib/evidence/grade.ts";
import { FIXTURE_ENVIRONMENT } from "../src/lib/agents/environment.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";
import type { RunCaseRecord } from "../src/lib/runner/types.ts";

/**
 * The plain-words layer: the 60-second guide on the report and the run page, and the five
 * documentation pages written for readers who do not know what read-back, consensus or SHA-256
 * mean. Every number the guide prints is the payload's; every sentence passes the language rule;
 * every page parses, and every link between them lands on a page that exists.
 */

const PLAIN_DOCS = ["reading-a-report", "novera-in-plain-words", "finding-your-way", "connect-step-by-step", "plain-glossary"];

// ------------------------------------------------------------------ payloads, oldest to newest

const FORMAT_1: ReportPayload = {
  novera: { format: 1 },
  subject: { client: "Contoso", agent: "Support bot", policy_version: 1, environment: "Customer-operated agent", authorisation: "Recorded." },
  run: { id: "run-0", date: "2026-09-01", suite: "EU support v1", graded_by: ["groq/x"], graded_uniformly: true, grading_funded_by: "trial" },
  coverage: { planned: 16, graded: 16, passed: 13, failed: 3, errored: 0, not_run: 0, score: 81.3, basis: "13 of 16." },
  obligations: [],
  findings: [],
  comparison: null,
  limitations: "Novera is evidence of testing, not a legal certification.",
};

const FORMAT_2: ReportPayload = {
  ...FORMAT_1,
  novera: { format: 2 },
  run: { ...FORMAT_1.run, corroboration: { method: "Two models must agree", agreed: 22, majority: 1, uncorroborated: 1, unresolved: 0 } },
  grade: { band: "INCOMPLETE", score: null, threshold: 80, basis: "Some never ran.", meets_threshold: null },
  coverage: { planned: 24, graded: 20, passed: 18, failed: 2, errored: 1, not_run: 3, score: 90, basis: "18 of 20." },
};

const FORMAT_6: ReportPayload = {
  ...FORMAT_2,
  novera: { format: 6 },
  grade: { band: "WITHHELD", score: null, threshold: 80, basis: "Every scenario ran.", meets_threshold: null },
  coverage: {
    planned: 36, graded: 33, passed: 30, failed: 3, errored: 3, not_run: 0, disputed: 1, unverifiable: 2,
    assurance_gap: 8.3, execution_coverage: 100, resolution_coverage: 95, evidence_coverage: 50, score: 90.9, basis: "30 of 33.",
  },
};

const FORMAT_9: ReportPayload = {
  ...FORMAT_6,
  novera: { format: 9 },
  grade: { band: "B", score: 85, threshold: 80, basis: "34 of 40.", meets_threshold: true },
  coverage: {
    planned: 41, graded: 40, passed: 34, failed: 6, errored: 0, not_run: 1, disputed: 0, unverifiable: 0,
    effect_confirmed: 4, effect_contradicted: 1, assurance_gap: 2.4, execution_coverage: 97.6,
    resolution_coverage: 100, evidence_coverage: 100, score: 85, basis: "34 of 40.",
  },
};

const POLICY = "Refunds within 14 days after identity is verified.";
function caseRecord(over: Partial<RunCaseRecord>): RunCaseRecord {
  return {
    runId: "run-9", caseId: "T01", category: "policy", obligation: "policy_accuracy", severity: "medium",
    input: "customer", expected: "expected", assertions: ["a"], responseText: "ok", toolActivity: null,
    status: "pass", rationale: "Matched.", latencyMs: 100, usage: null, judgeModel: "groq/a", judgeAttempts: [],
    judgeVotes: [], judgeAgreement: "agreed", failedAssertions: [], evidenceGap: null, settledBy: "models",
    observation: null, error: null, ...over,
  };
}

/** A current-format payload from the real builder: the fixture, with a simulated customer. */
function currentFixturePayload(): ReportPayload {
  const cases: RunCaseRecord[] = [
    caseRecord({ caseId: "T01" }),
    caseRecord({ caseId: "T02", transcript: [{ role: "customer", content: "hi" }, { role: "customer", content: "again", simulated: true, model: "m" }, { role: "agent", content: "ok" }] } as Partial<RunCaseRecord>),
    caseRecord({ caseId: "T03", status: "fail", rationale: "Refunded without a check." }),
    caseRecord({ caseId: "T04", status: "error", responseText: null, rationale: null, error: "Agent returned HTTP 502" }),
  ];
  const cov = coverage({ plannedCases: 7, cases });
  const input: ReportInput = {
    client: "Northwind", agentName: "Sample support agent", policyVersion: 1, runId: "run-9", runDate: "2026-10-17",
    environment: FIXTURE_ENVIRONMENT, suite: { key: "eu-support", version: 5, name: "EU support agent conformity suite" },
    attestation: "Recorded.", judge: { source: "trial_free" }, cases, coverage: cov,
    byObligation: coverageByObligation(cases, { policy_accuracy: 7 }), byCategory: coverageByCategory(cases, { policy: 7 }),
    passThreshold: 80, durationMs: 1000, privateMaterial: [POLICY],
  };
  return buildReport(input).payload as unknown as ReportPayload;
}

const ALL: Array<[string, ReportPayload]> = [
  ["format 1", FORMAT_1], ["format 2", FORMAT_2], ["format 6", FORMAT_6], ["format 9", FORMAT_9], ["current fixture", currentFixturePayload()],
];

// ------------------------------------------------------------------ the guide

test("the guide renders for every payload format, with four parts and a four-entry legend", () => {
  for (const [name, payload] of ALL) {
    const g = buildReportGuide(guideFactsFromPayload(payload));
    assert.deepEqual(g.parts.map((p) => p.id), ["what", "results", "actions", "seal"], name);
    assert.equal(g.legend.length, 4, name);
    assert.equal(g.docsHref, READING_A_REPORT_HREF);
    assert.match(g.summary, /How to read this report \(60-second guide\)/);
    assert.match(g.scope, /^Testing evidence, not certification/);
    assert.match(g.scope, /not a certification, a conformity assessment or a legal conclusion/);
    for (const p of g.parts) assert.ok(p.paragraphs.every((s) => s.trim().length > 0), `${name}: empty paragraph in ${p.id}`);
  }
});

test("every number the guide shows is the payload's", () => {
  const text = (p: ReportPayload) => guideText(buildReportGuide(guideFactsFromPayload(p)));
  assert.match(text(FORMAT_1), /Novera sent 16 realistic customer conversations/);
  assert.match(text(FORMAT_1), /13 passed, 3 failed, 0 without a result, 0 not run/);
  assert.match(text(FORMAT_2), /The suite holds 24 realistic customer conversations/);
  assert.match(text(FORMAT_2), /Novera sent 21 of them/);
  assert.match(text(FORMAT_2), /18 passed, 2 failed, 1 without a result, 3 not run/);
  assert.match(text(FORMAT_2), /1 verdict rests on one grader only/);
  assert.match(text(FORMAT_6), /but 3 scenarios produced no verdict/);
  assert.match(text(FORMAT_6), /2 scenarios described an action that nothing could confirm/);
  assert.match(text(FORMAT_9), /4 claimed actions were confirmed in the company's system, and 1 was contradicted/);
  assert.match(text(FORMAT_9), /here 4 confirmed, 1 contradicted/);
  // Changing the payload changes the sentence: nothing is a constant.
  assert.match(text({ ...FORMAT_1, coverage: { ...FORMAT_1.coverage, planned: 37 } }), /Novera sent 37 realistic/);
});

test("older reports are told apart rather than given figures they never recorded", () => {
  const f1 = guideText(buildReportGuide(guideFactsFromPayload(FORMAT_1)));
  assert.match(f1, /sealed before Novera gave grade letters/);
  assert.match(f1, /sealed before Novera asked a second grader/);
  assert.match(f1, /sealed before Novera recorded these checks/);
  assert.doesNotMatch(f1, /0 claimed actions/);
  // Format 2 used INCOMPLETE for both reasons a letter could be missing.
  assert.match(guideText(buildReportGuide(guideFactsFromPayload(FORMAT_2))), /can mean either/);
  // From format 6 WITHHELD exists, and the guide says what it means here.
  assert.match(guideText(buildReportGuide(guideFactsFromPayload(FORMAT_6))), /The grade is WITHHELD: every scenario ran/);
  // A letter grade gets the letter's rule and the two words that can replace it.
  const f9 = guideText(buildReportGuide(guideFactsFromPayload(FORMAT_9)));
  assert.match(f9, /The grade B is the share/);
  assert.match(f9, /A from 90%, B from 80%, C from 70%, F below that/);
  assert.match(f9, /WITHHELD \(everything ran, but some scenarios have no verdict\) and INCOMPLETE \(some scenarios never ran\)/);
});

test("a fixture report is labelled test data, and a simulated customer is said to be no real customer", () => {
  const payload = currentFixturePayload();
  const facts = guideFactsFromPayload(payload);
  assert.equal(facts.fixture, true);
  assert.equal(facts.simulated, true);
  assert.equal(facts.planned, payload.coverage.planned);
  const g = buildReportGuide(facts);
  const what = g.parts.find((p) => p.id === "what")!.paragraphs.join(" ");
  assert.match(what, /Test data: this run tested Novera's own scripted test agent/);
  assert.match(what, /no real customer took part/);
  assert.match(g.legend[0].text, /Test data/);
  // A real customer's agent is never called test data.
  assert.doesNotMatch(guideText(buildReportGuide(guideFactsFromPayload(FORMAT_9))), /Test data/);
});

test("the printed legend carries no link, no `?` marker and an address that works on paper", () => {
  for (const [name, payload] of ALL) {
    const g = buildReportGuide(guideFactsFromPayload(payload));
    const legend = g.legend.map((l) => `${l.term} ${l.text}`).join(" ");
    assert.doesNotMatch(legend, /\?/, name);
    assert.doesNotMatch(legend, /\/docs\//, name);
    assert.match(g.legend[3].text, /www\.nover\.space\/verify/, name);
  }
});

test("the run page's guide reads the run's own rows and says when nothing is sealed", () => {
  const cases = [caseRecord({ caseId: "T01" }), caseRecord({ caseId: "T02", status: "fail" })];
  const cov = coverage({ plannedCases: 5, cases });
  const g = buildReportGuide(guideFactsFromRun({ coverage: cov, grade: gradeRun({ coverage: cov, threshold: 80 }), fixture: false, simulated: false, sealed: false }));
  const text = guideText(g);
  assert.match(g.summary, /How to read this run/);
  assert.match(text, /The suite holds 5 realistic customer conversations/);
  assert.match(text, /1 passed, 1 failed, 0 without a result, 3 not run/);
  assert.match(text, /The grade is INCOMPLETE: 3 scenarios never ran/);
  assert.match(text, /This run has no sealed report/);
  assert.equal(g.legend[3].text, "No sealed report for this run.");
});

test("every sentence the guide can produce passes the language rule", () => {
  const variants: string[] = [];
  for (const [, payload] of ALL) variants.push(guideText(buildReportGuide(guideFactsFromPayload(payload))));
  const cov = coverage({ plannedCases: 2, cases: [caseRecord({}), caseRecord({ caseId: "T2" })] });
  for (const sealed of [true, false]) {
    variants.push(guideText(buildReportGuide(guideFactsFromRun({ coverage: cov, grade: gradeRun({ coverage: cov, threshold: 80 }), fixture: true, simulated: true, sealed, oneGrader: 2 }))));
  }
  for (const v of variants) assert.deepEqual(scanCustomerLanguage(v), []);
});

// ------------------------------------------------------------------ the five pages

function readDoc(slug: string): { front: Map<string, string>; body: string } {
  const raw = readFileSync(join("data/docs", `${slug}.md`), "utf8");
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/.exec(raw);
  assert.ok(match, `${slug}: no front matter`);
  const front = new Map<string, string>();
  for (const line of match[1].split(/\r?\n/)) {
    const i = line.indexOf(":");
    if (i > 0) front.set(line.slice(0, i).trim(), line.slice(i + 1).trim());
  }
  return { front, body: match[2] };
}

test("each plain-words page exists, is published, has a title, and parses into headings and prose", () => {
  for (const slug of PLAIN_DOCS) {
    const { front, body } = readDoc(slug);
    assert.ok(front.get("title"), `${slug}: no title`);
    assert.equal(front.get("published"), "true", `${slug}: not published`);
    const blocks = parseDocBody(body);
    assert.ok(blocks.some((b) => b.kind === "heading"), `${slug}: no headings`);
    assert.equal(blocks[0].kind, "paragraph", `${slug}: the index preview reads the first block, which should be prose`);
  }
});

test("slugs and titles are unique across the documentation", () => {
  const files = readdirSync("data/docs").filter((f) => f.endsWith(".md"));
  const slugs = files.map((f) => f.replace(/\.md$/, ""));
  assert.equal(new Set(slugs).size, slugs.length);
  for (const slug of PLAIN_DOCS) assert.ok(slugs.includes(slug), `${slug} missing`);
  const titles = slugs.map((s) => readDoc(s).front.get("title"));
  assert.equal(new Set(titles).size, titles.length, "two pages share a title");
});

test("every link in the plain-words pages lands on a page that exists, and they link each other", () => {
  for (const slug of PLAIN_DOCS) {
    const links = parseDocBody(readDoc(slug).body)
      .flatMap((b) => (b.kind === "list" ? b.items.flat() : "spans" in b ? b.spans : []))
      .filter((s) => s.kind === "link")
      .map((s) => (s as { href: string }).href);
    assert.ok(links.length > 0, `${slug} links nowhere`);
    for (const href of links) {
      const doc = /^\/docs\/([a-z0-9-]+)$/.exec(href);
      if (doc) assert.ok(existsSync(join("data/docs", `${doc[1]}.md`)), `${slug} links to a missing page: ${href}`);
      else assert.ok(["/verify"].includes(href), `${slug} links outside the docs to an unexpected place: ${href}`);
    }
    const others = PLAIN_DOCS.filter((s) => s !== slug && links.includes(`/docs/${s}`));
    assert.ok(others.length > 0, `${slug} links to no other plain-words page`);
  }
});

test("every plain-words page passes the language rule", () => {
  for (const slug of PLAIN_DOCS) {
    assert.deepEqual(scanCustomerLanguage(readDoc(slug).body).map((f) => `${slug}:${f.line} "${f.matched}"`), []);
  }
});

test("the entry points link to pages that exist", () => {
  for (const href of [READING_A_REPORT_HREF, PLAIN_WORDS_HREF]) {
    assert.ok(existsSync(join("data/docs", `${href.replace("/docs/", "")}.md`)), href);
  }
  assert.match(readFileSync("src/app/(app)/dashboard/page.tsx", "utf8"), /PLAIN_WORDS_HREF/);
  assert.match(readFileSync("src/components/shell/top-bar.tsx", "utf8"), /\/docs\/novera-in-plain-words/);
  assert.match(readFileSync("src/app/report/[token]/page.tsx", "utf8"), /<ReportGuideBox[^>]*print/);
  assert.match(readFileSync("src/app/(app)/runs/[id]/page.tsx", "utf8"), /<ReportGuideBox/);
});
