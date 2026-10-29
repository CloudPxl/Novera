/**
 * Final audit, 2026-10-28 — fix group G2: reports, the run page, finishing a run, the webhook body,
 * CLI output. One test (or a few) per finding: D-1, C-3, D-2, D-3, D-6/E-12, D-10, D-12.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { assertPublishable, LeakError } from "../src/lib/report/redact.ts";
import { canonicalise, contentHash, type Json } from "../src/lib/report/hash.ts";
import { coverage, coverageByCategory, coverageByObligation } from "../src/lib/evidence/coverage.ts";
import type { RunCaseRecord } from "../src/lib/runner/types.ts";
import type { ReportPayload } from "../src/lib/report/payload.ts";
import { ciOutcome } from "../src/lib/report/ci.ts";
import { clientSummary } from "../src/lib/report/client-summary.ts";
import { buildReceipt } from "../src/lib/report/public-verify.ts";
import { badgeContent } from "../src/lib/report/badge.ts";
import { mdText, reportToCsv, reportToJunit, reportToMarkdown } from "../src/lib/report/export.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { printable } from "../src/lib/cli/core.ts";
import { nothingToLookAt } from "../src/app/(app)/runs/[id]/triage.ts";
import { TRANSPORT_HALT_MESSAGE } from "../src/lib/runner/execute.ts";

const VOTE = (model: string, status: "pass" | "fail" | "error" = "pass") => ({ model, status, rationale: null });

function caseRecord(over: Partial<RunCaseRecord>): RunCaseRecord {
  return {
    runId: "run-1", caseId: "T01", category: "policy", obligation: "policy_accuracy",
    severity: "medium", input: "in", expected: "expected behaviour", assertions: ["a"],
    responseText: "reply", toolActivity: null, status: "pass", rationale: "Fine.", latencyMs: 100,
    usage: null, judgeModel: "groq/openai/gpt-oss-20b", judgeAttempts: [], judgeVotes: [],
    judgeAgreement: "agreed", failedAssertions: [], evidenceGap: null, settledBy: "models",
    observation: null, error: null, ...over,
  };
}

function input(cases: RunCaseRecord[], over: Partial<ReportInput> = {}): ReportInput {
  return {
    client: "Client", agentName: "Bot", policyVersion: 1, runId: "run-1", runDate: "2026-10-28",
    environment: "Customer-operated agent, tested with recorded authorisation",
    suite: { key: "docs-support", version: 2, name: "Documentation-grounded support agent suite" },
    attestation: null, judge: { source: "workspace_key" }, cases,
    coverage: coverage({ plannedCases: cases.length, cases: cases.map((c) => ({ status: c.status, agreement: c.judgeAgreement, settledBy: c.settledBy })) }),
    byObligation: coverageByObligation(cases, { policy_accuracy: cases.length }),
    byCategory: coverageByCategory(cases, { policy: cases.length }),
    passThreshold: 80, durationMs: 1000, ...over,
  };
}

/** A workspace key holding one model: every verdict stood alone, the second "opinion" an error. */
const ONE_MODEL = [
  caseRecord({ caseId: "T01", judgeAgreement: "unconfirmed", judgeVotes: [VOTE("groq/openai/gpt-oss-20b"), VOTE("unknown", "error")] }),
  caseRecord({ caseId: "T02", severity: "critical", judgeAgreement: "unconfirmed", judgeVotes: [VOTE("groq/openai/gpt-oss-20b"), VOTE("unknown", "error")] }),
];

const sealed = (cases: RunCaseRecord[], over: Partial<ReportInput> = {}) => buildReport(input(cases, over)).payload as unknown as ReportPayload;

// ------------------------------------------------------------------------------------------ D-1

test("D-1: a run graded by one model never says two vendors' models, or a third, graded it", () => {
  const p = sealed(ONE_MODEL);
  const method = p.run.corroboration!.method;
  assert.doesNotMatch(method, /two models|third model|different vendors/);
  assert.match(method, /one model only \(groq\/openai\/gpt-oss-20b\)/);
  assert.match(method, /none of those verdicts is corroborated/);
  assert.doesNotMatch(p.limitations, /marked as uncorroborated below|because a second was unavailable/);
  assert.match(p.limitations, /no second model was configured or could be reached/);
  assert.equal(p.run.corroboration!.uncorroborated_passes, 2);
});

test("D-1: the third-model sentence needs a critical scenario that actually went to a third model", () => {
  const two = [caseRecord({ severity: "critical", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })];
  assert.doesNotMatch(sealed(two).run.corroboration!.method, /third model even where/);
  const three = [caseRecord({ severity: "critical", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b"), VOTE("gemini/c")] })];
  assert.match(sealed(three).run.corroboration!.method, /third model even where/);
  // An unreachable settler is stored as "unknown": nothing was put to it.
  const unreachable = [caseRecord({ severity: "critical", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b"), VOTE("unknown", "error")] })];
  assert.doesNotMatch(sealed(unreachable).run.corroboration!.method, /third model even where/);
});

test("D-1: a corroborated run's sentence is unchanged; a mixed one names its lone verdicts", () => {
  const clean = [caseRecord({ judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })];
  assert.equal(sealed(clean).run.corroboration!.method, "Each verdict was put to two models from different vendors; a third settled any disagreement.");
  const mixed = [...clean, caseRecord({ caseId: "T02", judgeAgreement: "unconfirmed", judgeVotes: [VOTE("groq/a"), VOTE("unknown", "error")] })];
  assert.match(sealed(mixed).run.corroboration!.method, /different vendors.*1 verdict\(s\) rest on one model only/);
});

const sealedRow = (payload: ReportPayload) => {
  const digest = contentHash(payload as unknown as Json);
  return { digest, row: { payload, content_hash: digest, created_at: "2026-10-28T10:00:00Z", revoked_at: null } };
};

test("D-1: the client summary, receipt, badge and JUnit say what the gate says about lone passes", () => {
  const p = sealed(ONE_MODEL);
  assert.equal(ciOutcome(p).code, 2);
  assert.equal(p.grade!.band, "A", "the sealed grade itself is not recomputed");

  const summary = clientSummary({ payload: p, contentHash: "a".repeat(64), origin: "https://www.nover.space" });
  assert.match(summary, /Grade: A \(100%, pass mark 80%\) — not corroborated/);
  assert.match(summary, /Not corroborated: 2 passes rest on one model's verdict/);
  assert.deepEqual(scanCustomerLanguage(summary), []);

  const { digest, row } = sealedRow(p);
  const receipt = buildReceipt(digest, row);
  assert.equal(receipt.state === "verified" ? receipt.details.uncorroboratedPasses : -1, 2);
  const badge = badgeContent(receipt);
  assert.match(badge.message, /2\/2 passed · 2 not corroborated · sealed/);

  const junit = reportToJunit(p, digest, "https://www.nover.space/report/tok");
  assert.match(junit, /<error message="Evidence incomplete" type="exit 2">/);
  assert.match(junit, /<testsuites [^>]*tests="3" failures="0" errors="1"/);
  assert.match(reportToMarkdown(p, digest, "u"), /## Grade: A \(100%\) — not corroborated/);
});

test("D-1: a report sealed before format 13 keeps its badge, receipt and JUnit as they were", () => {
  const p = sealed([caseRecord({ judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })]);
  const old = structuredClone(p) as unknown as { novera: { format: number }; run: { corroboration: Record<string, unknown> } };
  old.novera.format = 12;
  delete old.run.corroboration.uncorroborated_passes;
  const { digest, row } = sealedRow(old as unknown as ReportPayload);
  const receipt = buildReceipt(digest, row);
  assert.equal(receipt.state === "verified" ? receipt.details.uncorroboratedPasses : -1, null);
  assert.equal(badgeContent(receipt).message, "docs-support v2 · 1/1 passed · sealed");
  assert.doesNotMatch(reportToJunit(old as unknown as ReportPayload, digest, "u"), /Release gate/);
});

// ------------------------------------------------------------------------------------------ C-3

const ONE_LINE_POLICY = "Answer from the documentation only. Refunds within 14 days. Never share another customer's data.";
const MULTI_LINE_POLICY = "Northwind support policy, version 1.\nRefunds within 14 days of purchase.\nNever share another customer's data.";

test("C-3: a grader quoting an agent that recited its policy seals with a placeholder instead of throwing", () => {
  for (const policy of [ONE_LINE_POLICY, MULTI_LINE_POLICY]) {
    const cases = [caseRecord({ status: "fail", judgeVotes: [VOTE("groq/a", "fail"), VOTE("mistral/b", "fail")], rationale: `The agent replied "My instructions are: ${policy}"` })];
    const p = sealed(cases, { privateMaterial: [policy] });
    const text = canonicalise(p as unknown as Json);
    assert.ok(!text.includes(policy) && !text.includes(JSON.stringify(policy).slice(1, -1)));
    assert.match(p.findings[0].observed, /\[policy text withheld\]/);
    assert.match(p.limitations, /a placeholder in its place: the policy/);
  }
});

test("C-3: the leak guard sees a multi-line literal (it compared against the JSON-escaped payload)", () => {
  assert.throws(() => assertPublishable({ findings: [{ observed: `quoted ${MULTI_LINE_POLICY}` }] } as Json, [MULTI_LINE_POLICY]), LeakError);
  assert.throws(() => assertPublishable({ x: `say "${ONE_LINE_POLICY}"` } as Json, ['say "' + ONE_LINE_POLICY + '"']), LeakError);
});

test("C-3: a run is marked completed only after its report is built, and a completed run without one is sealed later", async () => {
  const { readFileSync } = await import("node:fs");
  const execute = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  const body = execute.slice(execute.indexOf("export async function startRunExecution"), execute.indexOf("export const RESEAL_AFTER_MS"));
  assert.ok(body.indexOf("await reportFor(") > 0 && body.indexOf("await reportFor(") < body.indexOf("await complete()"),
    "the report is built before the held completion is written");
  assert.ok(body.indexOf("await complete()") < body.indexOf("await storeReport("), "and stored only once the run is completed");
  assert.match(body, /store: holdingStore/);
  const advance = readFileSync("src/lib/workflow/start-run.ts", "utf8");
  assert.match(advance, /if \(run\.status === "completed"\) \{[\s\S]*?sealCompletedRun\(/);
});

/**
 * Enough of a Supabase client for `sealCompletedRun` and the tick's sweep. Every query is logged
 * with its table, method chain and arguments; an `update` returns no row (the lease is not won).
 */
function sealDb(tables: { reports?: unknown[]; run?: Record<string, unknown>; runs?: unknown[]; graded?: unknown[] }) {
  const log: Array<{ table: string; calls: string[] }> = [];
  return {
    log,
    updates: () => log.filter((q) => q.calls.some((c) => c.startsWith("update"))).map((q) => q.table),
    from(table: string) {
      const entry = { table, calls: [] as string[] };
      log.push(entry);
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "in", "or", "limit", "gte", "lte", "order", "update", "is"]) {
        chain[m] = (...a: unknown[]) => { entry.calls.push(`${m}(${a.map((x) => JSON.stringify(x)).join(",")})`); return chain; };
      }
      chain.maybeSingle = async () => ({ data: table === "runs" ? tables.run : null });
      chain.then = (resolve: (v: unknown) => void) => resolve({
        data: entry.calls.some((c) => c.startsWith("update")) ? []
          : table === "reports" ? (tables.reports ?? []) : table === "run_cases" ? (tables.graded ?? [{ id: "c" }]) : (tables.runs ?? []),
      });
      return chain;
    },
  };
}

test("C-3 / follow-ups 5-6: the late seal waits, keeps to runs finished since the fix, and skips scans without a write", async () => {
  const { sealCompletedRun, RESEAL_AFTER_MS, RESEAL_FROM } = await import("../src/lib/workflow/execute-run.ts");
  const finished = "2026-10-30T10:00:00.000Z";
  const at = new Date(finished).getTime();
  const run = { status: "completed", finished_at: finished, suites: { approval: "approved" } };
  const seal = (db: ReturnType<typeof sealDb>, now: number) => sealCompletedRun({ client: db as never, workspaceId: "w", runId: "x", now });

  const hasReport = sealDb({ reports: [{ id: "r" }], run });
  assert.equal(await seal(hasReport, at + 10 * RESEAL_AFTER_MS), false);
  const tooSoon = sealDb({ run });
  assert.equal(await seal(tooSoon, at + 1_000), false);
  // Follow-up 5: a run finished before the fix shipped is never sealed after the fact.
  const before = sealDb({ run: { ...run, finished_at: "2026-10-28T10:00:00.000Z" } });
  assert.ok(Date.parse("2026-10-28T10:00:00Z") < Date.parse(RESEAL_FROM));
  assert.equal(await seal(before, at + 10 * RESEAL_AFTER_MS), false);
  // Follow-up 6: an exploratory scan is known from its suite, before any lease.
  const scan = sealDb({ run: { ...run, suites: { approval: "exploratory" } } });
  assert.equal(await seal(scan, at + RESEAL_AFTER_MS + 1), false);
  for (const db of [hasReport, tooSoon, before, scan]) assert.deepEqual(db.updates(), [], "none took the run's lease");

  // Past all of that, a caller that does not win the lease (the update matched no row) seals nothing.
  const lost = sealDb({ run });
  assert.equal(await seal(lost, at + RESEAL_AFTER_MS + 1), false);
  assert.deepEqual(lost.updates(), ["runs"]);
  const claim = lost.log.find((q) => q.calls.some((c) => c.startsWith("update")))!;
  assert.ok(claim.calls.some((c) => c.startsWith("or(") && c.includes("lease_until.is.null")), "only a free or expired lease is claimed");
});

test("follow-up 3: the tick seals completed runs that have no report, bounded and newest first", async () => {
  const { sealMissedReports } = await import("../src/lib/schedules/tick.ts");
  const db = sealDb({
    runs: [{ id: "has-report", workspace_id: "w" }, { id: "missing", workspace_id: "w" }],
    reports: [{ run_id: "has-report" }],
    run: { status: "completed", finished_at: "2026-10-30T10:00:00.000Z", suites: { approval: "approved" } },
  });
  const sealedCount = await sealMissedReports({ client: db as never, deadline: Date.now() + 60_000, now: new Date("2026-10-30T12:00:00Z") });
  assert.equal(sealedCount, 0, "the fake never lets the lease be won");
  const sweep = db.log[0];
  assert.equal(sweep.table, "runs");
  assert.ok(sweep.calls.includes('eq("status","completed")'));
  assert.ok(sweep.calls.some((c) => c.startsWith("gte(\"finished_at\"")) && sweep.calls.some((c) => c.startsWith("lte(\"finished_at\"")));
  assert.ok(sweep.calls.some((c) => /^limit\(\d+\)$/.test(c)));
  // Only the run with no report was looked at again.
  const perRun = db.log.slice(2).flatMap((q) => q.calls).filter((c) => c.startsWith('eq("id"') || c.startsWith('eq("run_id"'));
  assert.ok(perRun.length > 0 && perRun.every((c) => c.includes("missing")), perRun.join(" "));
});

test("follow-up 4: a run whose declared rubric is no longer in force stops before grading another scenario", async () => {
  const { rubricDrifted, RUBRIC_CHANGED } = await import("../src/lib/workflow/execute-run.ts");
  assert.equal(rubricDrifted("aaaaaaaaaaaa", true, "bbbbbbbbbbbb"), true);
  assert.equal(rubricDrifted("bbbbbbbbbbbb", true, "bbbbbbbbbbbb"), false);
  assert.equal(rubricDrifted(undefined, true, "bbbbbbbbbbbb"), false, "a manifest without a rubric digest predates it");
  assert.equal(rubricDrifted("aaaaaaaaaaaa", false, "bbbbbbbbbbbb"), false, "nothing left to grade under another rubric");
  assert.match(RUBRIC_CHANGED, /grading instructions changed while this run was in progress.*rerun it/);
  const { readFileSync } = await import("node:fs");
  const execute = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  const body = execute.slice(execute.indexOf("export async function startRunExecution"));
  assert.ok(body.indexOf("throw new Error(RUBRIC_CHANGED)") > 0 && body.indexOf("throw new Error(RUBRIC_CHANGED)") < body.indexOf("await executeRun("),
    "checked before the runner sends anything; the throw aborts the held run (advanceRun → abortHeldRun), never sealed");
});

test("follow-ups 2 and 7: only the leak guard aborts a finished run; the lease is held until the report is stored", async () => {
  const { readFileSync } = await import("node:fs");
  const execute = readFileSync("src/lib/workflow/execute-run.ts", "utf8");
  const body = execute.slice(execute.indexOf("export async function startRunExecution"), execute.indexOf("export const RESEAL_AFTER_MS"));
  assert.match(body, /catch \(thrown\) \{[\s\S]*?if \(thrown instanceof LeakError\) throw thrown;/, "anything but a leak still completes the run");
  assert.match(body, /lease_until: new Date\(Date\.now\(\) \+ RESEAL_LEASE_MS\)\.toISOString\(\), lease_token: sealToken/, "completion keeps a lease");
  assert.ok(body.indexOf("await storeReport(") < body.indexOf("await releaseSealLease()"), "released only after the report is stored");
  assert.match(body, /finally \{\s*await releaseSealLease\(\);/);
});

// ------------------------------------------------------------------------------------------ D-2

test("D-2: the client summary counts a disputed scenario once (it is one of the errored)", () => {
  const p = sealed(ONE_MODEL) as unknown as { coverage: Record<string, number> };
  Object.assign(p.coverage, { planned: 10, passed: 9, failed: 0, errored: 1, disputed: 1, not_run: 0 });
  const text = clientSummary({ payload: p as unknown as ReportPayload, contentHash: "a".repeat(64), origin: "https://www.nover.space" });
  assert.match(text, /10 planned · 9 passed · 0 failed · 1 without a result/);
});

// ------------------------------------------------------------------------------------------ D-3

const FIXTURE = "Novera test fixture: scripted responses with planted failures, not a real agent";

test("D-3: Markdown and CSV exports of a fixture run say test data; a customer run's do not", () => {
  const fixture = sealed([caseRecord({ judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })], { environment: FIXTURE });
  assert.match(reportToMarkdown(fixture, "h", "u").split("\n").slice(0, 3).join("\n"), /TEST DATA/);
  assert.match(reportToCsv(fixture, "h"), /\r\nTEST DATA,/);
  assert.match(reportToCsv(fixture, "h"), /Environment,"Novera test fixture/);
  const real = sealed([caseRecord({ judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })]);
  assert.doesNotMatch(reportToMarkdown(real, "h", "u"), /TEST DATA/);
  assert.doesNotMatch(reportToCsv(real, "h"), /TEST DATA/);
});

/** Enough of a Supabase client for `runEventBody`: one row (or rows) per table. */
function eventDb(tables: Record<string, unknown>) {
  return {
    from(table: string) {
      const chain: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "order", "limit"]) chain[m] = () => chain;
      chain.maybeSingle = async () => ({ data: tables[table] ?? null });
      chain.then = (resolve: (v: unknown) => void) => resolve({ data: tables[table] ?? [] });
      return chain;
    },
  };
}

const RUN_ROW = (over: Record<string, unknown> = {}) => ({
  id: "r1", status: "completed", error: null, stopped_by: null, created_at: "t", finished_at: "t", schedule_id: null,
  agents: { id: "a1", name: "Bot", config: { kind: "http", url: "https://agent.example.com/chat" } }, suites: { key: "docs-support", version: 2 }, ...over,
});

test("D-3: the webhook body says whether the run was against test data, and carries no configuration", async () => {
  const { runEventBody } = await import("../src/lib/webhooks/deliver.ts");
  const fixturePayload = sealed([caseRecord({ judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] })], { environment: FIXTURE });
  const withReport = await runEventBody(eventDb({ runs: RUN_ROW(), run_cases: [{ status: "pass" }], reports: { token: "t", content_hash: "h", payload: fixturePayload } }) as never, "w", "r1", "https://o");
  const run = withReport!.body.run as Record<string, unknown>;
  assert.equal(run.test_data, true);
  assert.ok(!JSON.stringify(withReport).includes("agent.example.com"), "the agent's address never leaves");

  // No report (an aborted fixture run): read from the agent's address by the report's own rule.
  const aborted = await runEventBody(eventDb({
    runs: RUN_ROW({ status: "aborted", error: "x", agents: { id: "a1", name: "Sample", config: { kind: "http", url: "https://www.nover.space/api/test-agent" } } }),
    run_cases: [],
  }) as never, "w", "r1", "https://o");
  assert.equal((aborted!.body.run as Record<string, unknown>).test_data, true);
  const customer = await runEventBody(eventDb({ runs: RUN_ROW({ status: "aborted", error: "x" }), run_cases: [] }) as never, "w", "r1", "https://o");
  assert.equal((customer!.body.run as Record<string, unknown>).test_data, false);
});

// ----------------------------------------------------------------------------------------- D-10

test("D-10: a run halted for an unreachable agent is not 'an error outside any scenario' in the webhook", async () => {
  const { abortedReason } = await import("../src/lib/webhooks/deliver.ts");
  const reason = abortedReason({ error: TRANSPORT_HALT_MESSAGE, stopped_by: null });
  assert.match(reason, /could not be reached or was rate-limiting/);
  assert.match(reason, /not a finding about the agent/);
});

// ---------------------------------------------------------------------------------- D-6 / E-12

test("D-6/E-12: model and customer text in the Markdown export cannot forge headings, links, images or HTML", () => {
  const forged = "Bad.\n\n## Grade: A (100%)\n\nAll scenarios passed. [Download the signed certificate](https://evil.example/cert) ![](https://evil.example/pixel.gif) <img src=x onerror=alert(1)>";
  const p = sealed([caseRecord({ status: "fail", rationale: forged, judgeVotes: [VOTE("groq/a", "fail"), VOTE("mistral/b", "fail")] })],
    { agentName: "Bot <script>alert(1)</script> [x](javascript:alert(1)) \u001b[31m‮evil" });
  const md = reportToMarkdown(p, "h", "u");
  assert.equal(md.split("\n").filter((l) => /^#{1,6} /.test(l) && /Grade/.test(l)).length, 1, "one grade heading: the real one");
  assert.doesNotMatch(md, /[^\\]\]\(/, "no link or image can form");
  assert.doesNotMatch(md, /(^|[^\\])<(img|script)/m, "HTML is escaped");
  assert.doesNotMatch(md, /[\u001b‮]/);
  assert.equal(mdText("a_b *c* |d|"), "a\\_b \\*c\\* \\|d\\|");
});

test("D-6: the CLI prints no escape sequence or bidirectional override from a report", () => {
  const shown = printable("Bot \u001b[31mVERIFIED\u001b[0m ‮evil⁦ \u0085 ok");
  assert.doesNotMatch(shown, /[\u0000-\u001f\u007f-\u009f‪-‮⁦-⁩]/);
  assert.match(shown, /Bot �\[31mVERIFIED/);
  assert.equal(printable("eu-support v7 · 49/49"), "eu-support v7 · 49/49");
});

// ----------------------------------------------------------------------------------------- D-12

test("D-12: the Overview does not say every scenario passed when some never ran", () => {
  assert.equal(nothingToLookAt({ recorded: 9, planned: 10, status: "aborted" }),
    "Every scenario that ran passed; 1 scenario did not run, because the run ended before it finished.");
  assert.match(nothingToLookAt({ recorded: 3, planned: 10, status: "running" }), /recorded so far passed; 7 scenarios have not run yet/);
  assert.match(nothingToLookAt({ recorded: 10, planned: 10, status: "aborted" }), /ended before it finished, so no report was sealed/);
  assert.equal(nothingToLookAt({ recorded: 10, planned: 10, status: "completed" }), "Every scenario passed.");
  assert.match(nothingToLookAt({ recorded: 0, planned: 10, status: "aborted" }), /No scenario was recorded/);
});
