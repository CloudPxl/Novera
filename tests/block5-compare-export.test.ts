import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { scenarioDeltas, type DeltaRun, type ScenarioEvidence, type ScenarioDelta } from "../src/lib/evidence/compare.ts";
import {
  buildComparisonExport, buildComparisonRefusal, comparisonFileName, renderComparisonMarkdown, serializeComparisonJson,
  COMPARISON_EXPORT_FORMAT, type ExportRun,
} from "../src/lib/evidence/comparison-export.ts";
import { gradersMovedNote } from "../src/lib/evidence/graders-moved.ts";
import { REPORT_NOTICE_PARAGRAPHS, REPORT_NOTICE_TITLE } from "../src/lib/legal/notices.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/**
 * Block 5, module 7 and the run page's graders-moved note (module 8.1): the comparison as a file.
 * The builders are pure, so the bytes a route sends are the bytes tested here.
 */

const sha = (c: string) => c.repeat(64);
const ev = (status: "pass" | "fail" | "error", reply: string): ScenarioEvidence => ({
  status, replied: true, rawSha: sha(reply), contentSha: sha(reply), conversation: false, observation: null,
});

function run(id: string, scenarios: string[], cases: Record<string, ScenarioEvidence>): DeltaRun {
  return {
    runId: id, agentId: "agent-1", suite: { key: "eu-support", version: 5, owner: null },
    scenarios: scenarios.map((s) => ({ id: s, digest: `digest-${s}`, severity: "high" })),
    cases: new Map(Object.entries(cases)),
  };
}

const IDS = ["T01", "T02", "T03", "T04", "T05"];

function deltasFor(base: Record<string, ScenarioEvidence>, target: Record<string, ScenarioEvidence>) {
  const d = scenarioDeltas(run("b", IDS, base), run("t", IDS, target));
  assert.ok(d.ok);
  return d;
}

const runInfo = (id: string, extra: Partial<ExportRun> = {}): ExportRun => ({
  id, status: "completed", startedAt: "2026-10-14T09:00:00.000Z", completedAt: "2026-10-14T09:04:00.000Z", agent: "Support agent",
  suite: { name: "EU support", key: "eu-support", version: 5, digest: sha("d") },
  seal: { sha256: sha("a"), sealedAt: "2026-10-14T09:05:00.000Z", withdrawnAt: null },
  ...extra,
});

const NOW = new Date("2026-10-16T08:00:00.000Z");
const titles = new Map([["T01", "Discloses it is an AI"], ["T02", "Escalates to a person"], ["T03", "Holds its refund limit"]]);

// A mixed comparison: T01 regressed, T02 fixed, T03 moved on an identical reply, T04 still passing, T05 still failing.
const MIXED = deltasFor(
  { T01: ev("pass", "1"), T02: ev("fail", "2"), T03: ev("pass", "3"), T04: ev("pass", "4"), T05: ev("fail", "5") },
  { T01: ev("fail", "9"), T02: ev("pass", "8"), T03: ev("fail", "3"), T04: ev("pass", "4"), T05: ev("fail", "5") },
);

function build(deltas = MIXED, otherDifferences: string[] = []) {
  return buildComparisonExport({ base: runInfo("base-run"), target: runInfo("target-run", { seal: null }), deltas, otherDifferences, titles, now: NOW });
}

test("the summary uses the page's sentences, singular and plural", () => {
  const one = build();
  assert.equal(one.summary.headline, "1 previously passing scenario now fails");
  assert.deepEqual(one.summary.lines, ["1 scenario now passes", "1 scenario where the reply was unchanged and only the graders moved"]);

  const clean = build(deltasFor({ T01: ev("pass", "1"), T02: ev("pass", "2") }, { T01: ev("pass", "1"), T02: ev("pass", "2") }));
  assert.equal(clean.summary.headline, "No previously passing scenario failed");
  assert.deepEqual(clean.summary.lines, ["0 scenarios now pass", "0 scenarios where the reply was unchanged and only the graders moved"]);

  const three = deltasFor(
    { T01: ev("pass", "1"), T02: ev("pass", "2"), T03: ev("pass", "3"), T04: ev("fail", "4"), T05: ev("fail", "5") },
    { T01: ev("fail", "a"), T02: ev("fail", "b"), T03: ev("fail", "c"), T04: ev("pass", "d"), T05: ev("pass", "e") },
  );
  const many = build(three);
  assert.equal(many.summary.headline, "3 previously passing scenarios now fail");
  assert.equal(many.summary.lines[0], "2 scenarios now pass");
});

test("a comparison with nothing defined identically does not claim that nothing failed", () => {
  const b = run("b", ["T01"], { T01: ev("pass", "1") });
  const t = { ...run("t", ["T01"], { T01: ev("fail", "2") }), scenarios: [{ id: "T01", digest: "other", severity: "high" }] };
  const d = scenarioDeltas(b, t);
  assert.ok(d.ok);
  assert.equal(build(d).summary.headline, "No scenario could be compared: none is defined identically in both runs");
});

test("only changed scenarios are rows, each with id, title, before to after and cause", () => {
  const doc = build();
  assert.deepEqual(doc.scenarios.map((s) => s.id).sort(), ["T01", "T02", "T03"]);
  const t01 = doc.scenarios.find((s) => s.id === "T01")!;
  assert.equal(t01.title, "Discloses it is an AI");
  assert.equal(t01.before, "passed");
  assert.equal(t01.after, "failed");
  assert.equal(t01.change, "Regressed");
  assert.equal(t01.cause?.key, "agent_changed");
  const t03 = doc.scenarios.find((s) => s.id === "T03")!;
  assert.equal(t03.change, "Moved on an identical reply");
  assert.equal(t03.cause?.key, "graders_changed");
  // A title missing from the suite falls back to the id, never to a made-up name.
  assert.equal(build(deltasFor({ T04: ev("pass", "4") }, { T04: ev("fail", "x") })).scenarios[0].title, "T04");
});

test("both runs are named with ids, times, suite, digest, seal and agent", () => {
  const md = renderComparisonMarkdown(build(MIXED, ["The policy changed: v1 → v2."]));
  assert.match(md, /^# Novera Run Comparison Appendix\n/);
  assert.match(md, /### Base/);
  assert.match(md, /### Target/);
  assert.ok(md.includes("`base-run`") && md.includes("`target-run`"));
  assert.ok(md.includes("Started: 2026-10-14 09:00:00 UTC") && md.includes("Completed: 2026-10-14 09:04:00 UTC"));
  assert.ok(md.includes("EU support (eu-support v5)"));
  assert.ok(md.includes(`Suite digest (SHA-256): \`${sha("d")}\``));
  assert.ok(md.includes(`Sealed report (SHA-256): \`${sha("a")}\``));
  assert.ok(md.includes("Sealed report: not sealed"), "an unsealed run says so");
  assert.ok(md.includes("Agent: Support agent"));
  assert.ok(md.includes("- The policy changed: v1 → v2."));
  assert.ok(md.includes("| T01 | Discloses it is an AI | high | passed | failed | Regressed |"));
  const noDigest = renderComparisonMarkdown(buildComparisonExport({
    base: runInfo("b", { suite: { name: "EU support", key: "eu-support", version: 5, digest: null } }), target: runInfo("t"), deltas: MIXED, otherDifferences: [], titles, now: NOW,
  }));
  assert.ok(noDigest.includes("not recorded (the run predates suite digests)"));
});

test("a withdrawn seal is named as withdrawn", () => {
  const md = renderComparisonMarkdown(buildComparisonExport({
    base: runInfo("b", { seal: { sha256: sha("a"), sealedAt: "2026-10-14T09:05:00.000Z", withdrawnAt: "2026-10-15T10:00:00.000Z" } }),
    target: runInfo("t"), deltas: MIXED, otherDifferences: [], titles, now: NOW,
  }));
  assert.match(md, /withdrawn 2026-10-15 10:00:00 UTC/);
});

test("the standing notice closes the Markdown verbatim, and rides in the JSON", () => {
  const md = renderComparisonMarkdown(build());
  assert.ok(md.includes(REPORT_NOTICE_TITLE));
  for (const paragraph of REPORT_NOTICE_PARAGRAPHS) assert.ok(md.includes(paragraph));
  assert.ok(md.trimEnd().endsWith(REPORT_NOTICE_PARAGRAPHS[REPORT_NOTICE_PARAGRAPHS.length - 1]));
  const json = JSON.parse(serializeComparisonJson(build()));
  assert.deepEqual(json.notice.text, REPORT_NOTICE_PARAGRAPHS);
  assert.equal(json.format, "novera-comparison/1");
  assert.equal(json.format, COMPARISON_EXPORT_FORMAT);
});

test("the JSON carries the same data as the Markdown", () => {
  const doc = build(MIXED, ["The suite version changed: v4 → v5."]);
  const json = JSON.parse(serializeComparisonJson(doc));
  assert.equal(json.comparable, true);
  assert.equal(json.runs.base.id, "base-run");
  assert.equal(json.runs.target.seal, null);
  assert.equal(json.runs.base.suite.digest, sha("d"));
  assert.equal(json.summary.headline, "1 previously passing scenario now fails");
  assert.equal(json.summary.regressed, 1);
  assert.equal(json.summary.fixed, 1);
  assert.equal(json.summary.graders_moved, 1);
  assert.deepEqual(json.summary.other_differences, ["The suite version changed: v4 → v5."]);
  assert.deepEqual(json.scenarios.map((s: { id: string }) => s.id), doc.scenarios.map((s) => s.id));
  assert.match(renderComparisonMarkdown(doc), /1 previously passing scenario now fails/);
});

test("runs that cannot be compared export the refusal sentence and nothing else of them", () => {
  const sentence = "These runs tested different agents. A comparison shows how one agent's results moved between two runs; another agent's results are not a regression of this one.";
  const refusal = buildComparisonRefusal({ reason: "different_agent", sentence, now: NOW });
  const md = renderComparisonMarkdown(refusal);
  assert.match(md, /# Novera Run Comparison Appendix/);
  assert.match(md, /## These runs cannot be compared/);
  assert.ok(md.includes(sentence));
  for (const paragraph of REPORT_NOTICE_PARAGRAPHS) assert.ok(md.includes(paragraph));
  const json = JSON.parse(serializeComparisonJson(refusal));
  assert.equal(json.comparable, false);
  assert.equal(json.reason, "different_agent");
  assert.equal(json.runs, undefined);
});

test("no raw evidence reaches the file: no input, reply, transcript, rationale or tool activity", () => {
  const FORBIDDEN = /^(?:input|response|response_text|reply|replies|transcript|rationale|tool_activity|observation|assertions|failed_assertions|expected_behavior|error)$/;
  const keys = new Set<string>();
  const walk = (v: unknown) => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) { keys.add(k); walk(x); }
  };
  walk(JSON.parse(serializeComparisonJson(build())));
  assert.deepEqual([...keys].filter((k) => FORBIDDEN.test(k)), []);
  // The loader's raw fields are not even in the builder's vocabulary, and the route selects none of them.
  const route = readFileSync("src/app/(app)/runs/compare/export/route.ts", "utf8");
  for (const column of ["response_text", "transcript", "tool_activity", "rationale", "run_cases"]) {
    assert.ok(!route.includes(column), `the export route reads ${column}`);
  }
  const builder = readFileSync("src/lib/evidence/comparison-export.ts", "utf8");
  assert.ok(!/\.input\b|responseText|\.rationale\b|\.transcript\b/.test(builder));
});

test("every string in the export follows the language rule", () => {
  const texts = [
    renderComparisonMarkdown(build(MIXED, ["The policy changed: v1 → v2."])),
    serializeComparisonJson(build()),
    renderComparisonMarkdown(buildComparisonRefusal({ reason: "unsettled", sentence: "The run started 2026-10-14 09:00 UTC has not finished, so its results are not final yet.", now: NOW })),
  ];
  for (const text of texts) assert.deepEqual(scanCustomerLanguage(text), []);
});

test("the route is a handler only, authenticated like the page, and never cached", () => {
  const route = readFileSync("src/app/(app)/runs/compare/export/route.ts", "utf8");
  const exported = [...route.matchAll(/^export\s+(?:async\s+)?(?:function|const)\s+(\w+)/gm)].map((m) => m[1]).sort();
  assert.deepEqual(exported, ["GET", "dynamic"]);
  assert.match(route, /loadComparison\(/);
  assert.match(route, /currentWorkspace\(\)/);
  assert.match(route, /no-store/);
  assert.match(route, /content-disposition/);
  assert.equal(comparisonFileName("12345678-aaaa", "abcdefgh-bbbb", "md"), "novera-comparison-12345678-abcdefgh.md");
});

// ---------------------------------------------------------------- the run page's graders-moved note

const delta = (caseId: string, category: ScenarioDelta["category"], base: ScenarioDelta["base"], target: ScenarioDelta["target"]): ScenarioDelta =>
  ({ caseId, category, severity: "high", base, target, reply: "same", cause: category === "verdict_moved_same_reply" ? "graders_changed" : null });

test("one scenario that left newly broken because only the graders moved is named, with the sealed report's count", () => {
  const note = gradersMovedNote({
    deltas: [delta("T03", "verdict_moved_same_reply", "pass", "fail"), delta("T01", "regressed", "pass", "fail")],
    baselineRunId: "base",
    sealedComparison: { baseline_run: "base", new_failures: ["T01", "T03"] },
  });
  assert.equal(note?.sentence, "1 scenario where the reply was unchanged and only the graders moved is excluded from newly broken.");
  assert.equal(note?.sealedSentence, "The sealed report, written when the run finished, counts it as newly broken.");
  assert.deepEqual(note?.ids, ["T03"]);
});

test("the plural form, and a sealed report that counts only some of them", () => {
  const deltas = [delta("T03", "verdict_moved_same_reply", "pass", "fail"), delta("T07", "verdict_moved_same_reply", "pass", "fail")];
  const all = gradersMovedNote({ deltas, baselineRunId: "b", sealedComparison: { baseline_run: "b", new_failures: ["T03", "T07"] } });
  assert.equal(all?.sentence, "2 scenarios where the reply was unchanged and only the graders moved are excluded from newly broken.");
  assert.equal(all?.sealedSentence, "The sealed report, written when the run finished, counts them as newly broken.");
  const some = gradersMovedNote({ deltas, baselineRunId: "b", sealedComparison: { baseline_run: "b", new_failures: ["T03"] } });
  assert.equal(some?.sealedSentence, "The sealed report, written when the run finished, counts 1 of them as newly broken.");
});

test("the sealed report is mentioned only when its stored comparison shows it", () => {
  const deltas = [delta("T03", "verdict_moved_same_reply", "pass", "fail")];
  const none = (sealedComparison: Parameters<typeof gradersMovedNote>[0]["sealedComparison"], baselineRunId: string | null = "b") =>
    gradersMovedNote({ deltas, baselineRunId, sealedComparison })?.sealedSentence;
  assert.equal(none(null), null, "no report, or a report with no comparison");
  assert.equal(none({ baseline_run: "other", new_failures: ["T03"] }), null, "the page compares with a different baseline than the report");
  assert.equal(none({ baseline_run: "b", new_failures: [] }), null, "the report does not list it");
  assert.equal(none({ baseline_run: "b" }), null, "an unreadable payload");
  assert.equal(none({ baseline_run: "b", new_failures: ["T03"] }, null), null, "no baseline on the page");
});

test("there is no note when nothing was excluded from newly broken", () => {
  assert.equal(gradersMovedNote({ deltas: [delta("T01", "regressed", "pass", "fail")], baselineRunId: "b", sealedComparison: null }), null);
  // A verdict that moved from fail to pass on an identical reply was never going to be newly broken.
  assert.equal(gradersMovedNote({ deltas: [delta("T02", "verdict_moved_same_reply", "fail", "pass")], baselineRunId: "b", sealedComparison: null }), null);
  assert.equal(gradersMovedNote({ deltas: [], baselineRunId: null, sealedComparison: null }), null);
});

test("the note's sentences follow the language rule", () => {
  const note = gradersMovedNote({
    deltas: [delta("T03", "verdict_moved_same_reply", "pass", "fail")], baselineRunId: "b", sealedComparison: { baseline_run: "b", new_failures: ["T03"] },
  })!;
  assert.deepEqual(scanCustomerLanguage(`${note.sentence} ${note.sealedSentence}`), []);
});
