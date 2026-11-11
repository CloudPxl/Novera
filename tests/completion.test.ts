import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  COMPLETION_LIMITATION, MAX_COMPLETIONS, completionNote, completionOf, eligibleScenarios, mergeChainRows, ownerOfEachScenario, type ChainLink,
} from "../src/lib/evidence/completion.ts";
import { buildRunManifest, manifestForNewRun } from "../src/lib/report/manifest.ts";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { verifyHash } from "../src/lib/report/hash.ts";
import { reportToCsv, reportToMarkdown } from "../src/lib/report/export.ts";
import { coverage, coverageByCategory, coverageByObligation } from "../src/lib/evidence/coverage.ts";
import { planCompletion } from "../src/lib/workflow/completion.ts";
import type { RunCaseRecord } from "../src/lib/runner/types.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";

const HASH_A = "a".repeat(64);

// ---------------------------------------------------------------- the chain and the merge

test("each scenario's row comes from the newest run in the chain that declared it, else the original", () => {
  const chain: ChainLink[] = [
    { runId: "c2", declared: ["T03"] },
    { runId: "c1", declared: ["T02", "T03"] },
    { runId: "orig", declared: null },
  ];
  const owner = ownerOfEachScenario(chain, ["T01", "T02", "T03"]);
  assert.deepEqual([...owner], [["T01", "orig"], ["T02", "c1"], ["T03", "c2"]]);
  const rows = [
    { run_id: "orig", case_id: "T01", status: "pass" }, { run_id: "orig", case_id: "T02", status: "error" }, { run_id: "orig", case_id: "T03", status: "error" },
    { run_id: "c1", case_id: "T02", status: "pass" }, { run_id: "c1", case_id: "T03", status: "error" },
    { run_id: "c2", case_id: "T03", status: "fail" },
  ];
  assert.deepEqual(mergeChainRows(chain, rows).map((r) => `${r.case_id}:${r.run_id}:${r.status}`), ["T01:orig:pass", "T02:c1:pass", "T03:c2:fail"]);
  // A completion row the chain's newest run did not record (it never reached it) does not fall back silently:
  // the newest declaring run owns the scenario, so its absence is a missing row, never an older verdict.
  assert.deepEqual(mergeChainRows(chain, rows.filter((r) => r.run_id !== "c2")).map((r) => r.case_id), ["T01", "T02"]);
});

test("completionOf reads only a well-formed completes block", () => {
  assert.equal(completionOf(null), null);
  assert.equal(completionOf({ suite: {} }), null);
  assert.equal(completionOf({ completes: { run_id: "r", report_hash: HASH_A } }), null);
  assert.deepEqual(completionOf({ completes: { run_id: "r", report_hash: HASH_A, scenario_ids: ["T02"] } }), { run_id: "r", report_hash: HASH_A, scenario_ids: ["T02"] });
});

test("eligibility: only a no-result scenario a retest cannot harm, of this suite, in suite order", () => {
  const merged = new Map([
    ["T01", { status: "pass", retry: null }],
    ["T02", { status: "error", retry: "safe" as const }],
    ["T03", { status: "error", retry: "fix_first" as const }],
    ["T04", { status: "error", retry: "check_first" as const }],
    ["T05", { status: "error", retry: "safe" as const }],
  ]);
  const order = ["T01", "T02", "T03", "T04", "T05", "T06"];
  const r = eligibleScenarios({ requested: ["T05", "T02"], suiteOrder: order, merged });
  assert.deepEqual(r, { ok: ["T02", "T05"], refused: [] }, "suite order, not request order");
  const bad = eligibleScenarios({ requested: ["T01", "T03", "T04", "T06", "T99"], suiteOrder: order, merged });
  assert.deepEqual(bad.ok, []);
  assert.deepEqual(bad.refused.map((x) => x.id).sort(), ["T01", "T03", "T04", "T06", "T99"]);
  assert.match(bad.refused.find((x) => x.id === "T01")!.why, /already has a verdict/);
  assert.match(bad.refused.find((x) => x.id === "T03")!.why, /cause is fixed/);
  assert.match(bad.refused.find((x) => x.id === "T04")!.why, /may already have acted/);
  assert.match(bad.refused.find((x) => x.id === "T99")!.why, /not a scenario of this run's suite/);
});

test("the completion note and limitation say what happened, from stored values, and nothing more", () => {
  const note = completionNote({ of: HASH_A, ofDate: "2026-11-09", scenarioIds: ["T02", "T05"], completedOn: "2026-11-11", runId: "c1", carriedFrom: ["orig"] });
  assert.match(note, new RegExp(`report sealed on 2026-11-09 with digest ${HASH_A}`));
  assert.match(note, /Scenarios T02, T05 produced no result there and were re-executed on 2026-11-11 in run c1/);
  assert.match(note, /carried unchanged from the stored evidence of run orig/);
  assert.match(completionNote({ of: HASH_A, ofDate: "d", scenarioIds: ["T02"], completedOn: "e", runId: "c2", carriedFrom: ["c1", "orig"] }), /Scenario T02 produced no result there and was re-executed .* run c1 and run orig/);
  for (const text of [note, COMPLETION_LIMITATION]) {
    for (const bad of [/certif(y|ied|ication) (that|the agent)/i, /compliant/i, /guarantee/i, /human review/i, /reviewed by/i]) assert.doesNotMatch(text, bad);
  }
});

// ---------------------------------------------------------------- the manifest

const manifestArgs = {
  runId: "c1", createdAt: "2026-11-11T10:00:00.000Z", agentId: "a1", agentUrl: "https://agent.example/chat", policyId: "p1", policyVersion: 3,
  suiteId: "s1", suiteKey: "eu-support", suiteVersion: 7, caseIds: ["T02", "T05"], suiteDigest: "b".repeat(64),
  judgeSource: "plan_managed" as const, passThreshold: 80, runnerVersion: "1.0.0",
};

test("a completion's manifest declares only its scenarios and what it completes; an ordinary one says nothing new", () => {
  const ordinary = buildRunManifest(manifestArgs);
  assert.equal("completes" in ordinary.manifest, false);
  const completion = buildRunManifest({ ...manifestArgs, completes: { runId: "orig", reportHash: HASH_A, scenarioIds: ["T02", "T05"] } });
  assert.deepEqual(completion.manifest.completes, { run_id: "orig", report_hash: HASH_A, scenario_ids: ["T02", "T05"] });
  assert.deepEqual(completion.manifest.suite.case_ids, ["T02", "T05"]);
  assert.notEqual(completion.hash, ordinary.hash);
});

function manifestClient(suiteCases: Array<{ id: string }>) {
  const tables: Record<string, Record<string, unknown>> = {
    agents: { config: { url: "https://agent.example/chat" }, verification: null },
    policies: { version: 3 },
    suites: { key: "eu-support", version: 7, name: "EU support", cases: suiteCases, provenance: null },
  };
  return {
    from(table: string) {
      const b = { select: () => b, eq: () => b, maybeSingle: () => Promise.resolve({ data: tables[table] ?? null, error: null }) };
      return b;
    },
  } as unknown as SupabaseClient;
}

test("manifestForNewRun: a completion declares its scenarios in suite order, the whole suite's digest, and what it completes", async () => {
  const cases = ["T01", "T02", "T03", "T04", "T05"].map((id) => ({ id, category: "c", obligation: "o", severity: "low", input: "i", expected_behavior: "e", assertions: ["a"] }));
  const whole = await manifestForNewRun({ client: manifestClient(cases), agentId: "a1", policyId: "p1", suiteId: "s1", judgeSource: "plan_managed", runId: "r0" });
  const done = await manifestForNewRun({
    client: manifestClient(cases), agentId: "a1", policyId: "p1", suiteId: "s1", judgeSource: "plan_managed", runId: "c1",
    completes: { runId: "r0", reportHash: HASH_A, scenarioIds: ["T05", "T02"] },
  });
  assert.deepEqual(whole.manifest?.suite.case_ids, ["T01", "T02", "T03", "T04", "T05"]);
  assert.deepEqual(done.manifest?.suite.case_ids, ["T02", "T05"]);
  assert.equal(done.manifest?.suite_digest, whole.manifest?.suite_digest, "the digest is of the suite row, which did not change");
  assert.deepEqual(done.manifest?.completes?.scenario_ids, ["T05", "T02"]);
  assert.equal(done.manifest?.agent.config_hash, whole.manifest?.agent.config_hash);
});

// ---------------------------------------------------------------- the report

function caseRecord(over: Partial<RunCaseRecord>): RunCaseRecord {
  return {
    runId: "orig", caseId: "T01", category: "policy", obligation: "policy_accuracy", severity: "medium", input: "in", expected: "ex",
    assertions: ["a"], responseText: "reply", toolActivity: null, status: "pass", rationale: "Met it.", latencyMs: 100, usage: null,
    judgeModel: "gemini/x", judgeAttempts: [], judgeVotes: [{ model: "gemini/x", status: "pass", rationale: null }, { model: "groq/y", status: "pass", rationale: null }],
    judgeAgreement: "agreed", failedAssertions: [], evidenceGap: null, settledBy: "models", observation: null, error: null, ...over,
  };
}

function reportInput(cases: RunCaseRecord[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    client: "Acme Demo", agentName: "Support bot", policyVersion: 3, runId: "c1", runDate: "2026-11-11", environment: "Isolated test environment",
    suite: { key: "eu-support", version: 7, name: "EU support" }, attestation: "Attested.", judge: { source: "plan_managed" }, cases,
    coverage: coverage({ plannedCases: 3, cases: cases.map((c) => ({ status: c.status, error: c.error, agreement: c.judgeAgreement, evidenceGap: c.evidenceGap, assertionCount: 1, failedAssertionCount: c.failedAssertions.length, requiresEvidence: false, settledBy: c.settledBy, observationStatus: null })) }),
    byObligation: coverageByObligation(cases, { policy_accuracy: 3 }), byCategory: coverageByCategory(cases, { policy: 3 }),
    passThreshold: 80, durationMs: 9000, privateMaterial: [], ...over,
  };
}

const original = [caseRecord({ caseId: "T01" }), caseRecord({ caseId: "T02", status: "error", responseText: null, rationale: null, judgeVotes: [], judgeAgreement: null, settledBy: null, error: "The agent did not answer within 30 s." }), caseRecord({ caseId: "T03" })];
const merged = [caseRecord({ caseId: "T01" }), caseRecord({ caseId: "T02", runId: "c1" }), caseRecord({ caseId: "T03" })];
const completionArgs = { of: HASH_A, ofRunId: "orig", ofDate: "2026-11-09", scenarioIds: ["T02"], carriedFrom: ["orig"], completedOn: "2026-11-11" };

test("an ordinary report is unchanged: format 16, no completion block, no completion limitation", () => {
  const { payload, contentHash } = buildReport(reportInput(original, { runId: "orig", runDate: "2026-11-09" }));
  const p = payload as unknown as ReportPayload;
  assert.equal(p.novera.format, 16);
  assert.equal("completion" in p, false);
  assert.ok(!p.limitations.includes(COMPLETION_LIMITATION));
  assert.equal(p.coverage.errored, 1);
  assert.ok(verifyHash(payload, contentHash));
});

test("a completion report is format 17, computes every count from the merged rows, names what it completes, and verifies", () => {
  const { payload, contentHash } = buildReport(reportInput(merged, { completion: completionArgs }));
  const p = payload as unknown as ReportPayload;
  assert.equal(p.novera.format, 17);
  assert.deepEqual({ planned: p.coverage.planned, passed: p.coverage.passed, errored: p.coverage.errored }, { planned: 3, passed: 3, errored: 0 });
  assert.deepEqual({ ...p.completion, note: undefined }, { of: HASH_A, of_run: "orig", of_date: "2026-11-09", scenario_ids: ["T02"], completed_on: "2026-11-11", carried_from: ["orig"], note: undefined });
  assert.match(p.completion!.note, /re-executed on 2026-11-11 in run c1/);
  assert.ok(p.limitations.includes(COMPLETION_LIMITATION));
  assert.ok(verifyHash(payload, contentHash));
});

test("exports state the completion only on a completion report", () => {
  const plain = buildReport(reportInput(original, { runId: "orig" }));
  const done = buildReport(reportInput(merged, { completion: completionArgs }));
  const csvPlain = reportToCsv(plain.payload as unknown as ReportPayload, plain.contentHash);
  const mdPlain = reportToMarkdown(plain.payload as unknown as ReportPayload, plain.contentHash, "https://www.nover.space/report/x");
  assert.doesNotMatch(csvPlain, /Completes report/);
  assert.doesNotMatch(mdPlain, /This report completes/);
  const csv = reportToCsv(done.payload as unknown as ReportPayload, done.contentHash);
  const md = reportToMarkdown(done.payload as unknown as ReportPayload, done.contentHash, "https://www.nover.space/report/x");
  assert.match(csv, new RegExp(`Completes report.*${HASH_A}`));
  assert.match(csv, /Re-executed scenarios.*T02/);
  assert.match(md, /This report completes the report sealed on 2026-11-09/);
});

// ---------------------------------------------------------------- planning a completion

type Row = Record<string, unknown>;
function planDb(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const filters: Array<(r: Row) => boolean> = [];
      const result = () => (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
      const b = {
        select: () => b,
        eq: (col: string, v: unknown) => { filters.push((r) => r[col] === v); return b; },
        in: (col: string, vs: unknown[]) => { filters.push((r) => vs.includes(r[col])); return b; },
        order: () => b,
        limit: () => b,
        maybeSingle: () => Promise.resolve({ data: result()[0] ?? null, error: null }),
        then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: result(), error: null }).then(resolve),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const suiteCases = [{ id: "T01" }, { id: "T02" }, { id: "T03" }, { id: "T04", effect: { kind: "refund" } }];
const baseTables = (): Record<string, Row[]> => ({
  runs: [{ id: "orig", workspace_id: "w1", agent_id: "a1", suite_id: "s1", policy_id: "p1", status: "completed", judge_source: "plan_managed", manifest: { suite: { case_ids: ["T01", "T02", "T03", "T04"] }, agent: { config_hash: "h" } } }],
  reports: [{ run_id: "orig", workspace_id: "w1", content_hash: HASH_A, payload: { run: { date: "2026-11-09" } }, revoked_at: null }],
  run_cases: [
    { id: "rc1", run_id: "orig", workspace_id: "w1", case_id: "T01", status: "pass" },
    { id: "rc2", run_id: "orig", workspace_id: "w1", case_id: "T02", status: "error", error: "The agent did not answer within 30 s.", response_text: null, judge_attempts: [] },
    { id: "rc3", run_id: "orig", workspace_id: "w1", case_id: "T03", status: "error", error: "Not sent: agent.example points to a private or internal address.", response_text: null, judge_attempts: [] },
    { id: "rc4", run_id: "orig", workspace_id: "w1", case_id: "T04", status: "error", error: "The agent did not answer within 30 s.", response_text: null, judge_attempts: [] },
  ],
  suites: [{ id: "s1", cases: suiteCases }],
  evidence_observations: [],
});

test("planning: a transient gap is completed; a configuration gap, an action that may have happened, and a verdict are refused", async () => {
  const ok = await planCompletion({ client: planDb(baseTables()), workspaceId: "w1", runId: "orig", scenarioIds: ["T02"] });
  assert.ok(!("error" in ok), JSON.stringify(ok));
  if ("error" in ok) return;
  assert.deepEqual(ok.scenarioIds, ["T02"]);
  assert.equal(ok.reportHash, HASH_A);
  assert.equal(ok.reportDate, "2026-11-09");
  assert.deepEqual(ok.chain, [{ runId: "orig", declared: null }]);

  for (const [ids, why] of [[["T03"], /cause is fixed/], [["T04"], /may already have acted/], [["T01"], /already has a verdict/]] as const) {
    const r = await planCompletion({ client: planDb(baseTables()), workspaceId: "w1", runId: "orig", scenarioIds: [...ids] });
    assert.ok("error" in r && why.test(r.error), `${ids}: ${JSON.stringify(r)}`);
  }
});

test("planning: refused for a run that is not completed, has no report, a withdrawn report, another workspace, or no scenario", async () => {
  const cases: Array<[string, (t: Record<string, Row[]>) => void, RegExp, string?]> = [
    ["stopped", (t) => { t.runs[0].status = "aborted"; }, /Only a completed run/],
    ["no report", (t) => { t.reports = []; }, /no sealed report/],
    ["withdrawn", (t) => { t.reports[0].revoked_at = "2026-11-10T00:00:00Z"; }, /withdrawn/],
    ["no manifest", (t) => { t.runs[0].manifest = null; }, /declared no manifest/],
    ["other workspace", () => undefined, /could not be found/, "w2"],
  ];
  for (const [name, mutate, why, ws] of cases) {
    const t = baseTables();
    mutate(t);
    const r = await planCompletion({ client: planDb(t), workspaceId: ws ?? "w1", runId: "orig", scenarioIds: ["T02"] });
    assert.ok("error" in r && why.test(r.error), `${name}: ${JSON.stringify(r)}`);
  }
  const none = await planCompletion({ client: planDb(baseTables()), workspaceId: "w1", runId: "orig", scenarioIds: [] });
  assert.ok("error" in none);
});

test("planning: a completion of a completion reads the merged evidence, and the chain stops at the limit", async () => {
  const t = baseTables();
  t.runs.push({ id: "c1", workspace_id: "w1", agent_id: "a1", suite_id: "s1", policy_id: "p1", status: "completed", judge_source: "plan_managed", manifest: { suite: { case_ids: ["T02"] }, completes: { run_id: "orig", report_hash: HASH_A, scenario_ids: ["T02"] } } });
  t.reports.push({ run_id: "c1", workspace_id: "w1", content_hash: "c".repeat(64), payload: { run: { date: "2026-11-10" } }, revoked_at: null });
  t.run_cases.push({ id: "rc5", run_id: "c1", workspace_id: "w1", case_id: "T02", status: "pass" });
  const already = await planCompletion({ client: planDb(t), workspaceId: "w1", runId: "c1", scenarioIds: ["T02"] });
  assert.ok("error" in already && /already has a verdict/.test(already.error), "T02 is resolved in the merged evidence");

  // A chain already MAX_COMPLETIONS deep is refused.
  const deep = baseTables();
  let prev = "orig";
  for (let i = 1; i <= MAX_COMPLETIONS; i++) {
    deep.runs.push({ id: `c${i}`, workspace_id: "w1", agent_id: "a1", suite_id: "s1", policy_id: "p1", status: "completed", judge_source: "plan_managed", manifest: { suite: { case_ids: ["T02"] }, completes: { run_id: prev, report_hash: HASH_A, scenario_ids: ["T02"] } } });
    deep.reports.push({ run_id: `c${i}`, workspace_id: "w1", content_hash: String(i).repeat(64), payload: { run: { date: "2026-11-10" } }, revoked_at: null });
    deep.run_cases.push({ id: `rcx${i}`, run_id: `c${i}`, workspace_id: "w1", case_id: "T02", status: "error", error: "The agent did not answer within 30 s.", response_text: null, judge_attempts: [] });
    prev = `c${i}`;
  }
  const limit = await planCompletion({ client: planDb(deep), workspaceId: "w1", runId: prev, scenarioIds: ["T02"] });
  assert.ok("error" in limit && /already been completed 3 times/.test(limit.error), JSON.stringify(limit));
});

// ---------------------------------------------------------------- the database and the run path

test("0083: one column, frozen, agreeing with the manifest, same workspace, one completion in progress", () => {
  const M = readFileSync("supabase/migrations/0083_completion_runs.sql", "utf8");
  assert.match(M, /alter table runs add column if not exists completes_run_id uuid references runs \(id\);/);
  assert.match(M, /check \(completes_run_id is null or \(manifest -> 'completes' ->> 'run_id'\) = completes_run_id::text\)/);
  assert.match(M, /check \(completes_run_id is null or completes_run_id <> id\)/);
  assert.match(M, /create unique index if not exists runs_one_completion_in_progress\s+on runs \(completes_run_id\) where completes_run_id is not null and status in \('queued', 'running'\);/);
  assert.match(M, /if new\.completes_run_id is distinct from old\.completes_run_id then/);
  assert.match(M, /execute function refuse_cross_workspace\('completes_run_id', 'runs'\);/);
  assert.doesNotMatch(M, /create or replace function erase_workspace/);
});

test("the one run path: startRun plans the completion, holds its terms, and the runner executes only what a run declared", () => {
  const start = readFileSync("src/lib/workflow/start-run.ts", "utf8");
  assert.match(start, /planCompletion\(\{ client, workspaceId, runId: args\.completes\.runId/);
  assert.match(start, /declared !== agentConfigHash\(agent\.config\)/, "same agent connection");
  assert.match(start, /policy\.id !== completion\.target\.policy_id/, "same policy version");
  assert.match(start, /entitlement\.judgeSource !== completion\.target\.judge_source/, "same grading funding");
  assert.match(start, /completes_run_id: completion\.target\.id/);
  const exec = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  assert.match(exec, /fullSuite\.cases\.filter\(\(c\) => \(declaredIds as unknown\[\]\)\.includes\(c\.id\)\)/, "a run executes exactly what it declared");
  assert.match(exec, /summaryFromStoredRows\(\{ client, runId: run\.id as string, suite: ctx\.fullSuite, status: whole\.status, error: whole\.error, chain \}\)/);
  const actions = readFileSync("src/lib/workflow/completion-actions.ts", "utf8");
  assert.match(actions, /gate\(user\.id, workspace\.id, "run\.start"\)/);
  assert.match(actions, /startRun\(\{/);
});
