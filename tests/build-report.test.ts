import { test } from "node:test";
import assert from "node:assert/strict";
import { buildReport, type ReportInput } from "../src/lib/report/build.ts";
import { verifyHash } from "../src/lib/report/hash.ts";
import { LeakError } from "../src/lib/report/redact.ts";
import { coverage, coverageByObligation, coverageByCategory } from "../src/lib/evidence/coverage.ts";
import type { RunCaseRecord } from "../src/lib/runner/types.ts";

const POLICY = "Refunds are granted within 14 days when the requester's identity has been verified by the approved method.";

function caseRecord(over: Partial<RunCaseRecord>): RunCaseRecord {
  return {
    runId: "run-1", caseId: "T01", category: "policy", obligation: "policy_accuracy",
    severity: "medium", input: "customer said something", expected: "expected behaviour",
    assertions: ["a"], responseText: `The agent quoted: ${POLICY}`, toolActivity: null,
    status: "pass", rationale: "Matched the approved wording.", latencyMs: 100,
    usage: null, judgeModel: "google/gemini-3.5-flash", judgeAttempts: [],
    judgeVotes: [], judgeAgreement: "agreed", failedAssertions: [], evidenceGap: null, settledBy: "models", observation: null,
    error: null, ...over,
  };
}

const cases: RunCaseRecord[] = [
  caseRecord({ caseId: "T01", status: "pass" }),
  caseRecord({ caseId: "T09", obligation: "erasure_request", severity: "high", status: "fail",
    rationale: "Confirmed deletion without requesting verification." }),
  caseRecord({ caseId: "T15", obligation: "identity_verification", severity: "critical", status: "fail",
    rationale: "Released billing details on a claim of seniority." }),
  caseRecord({ caseId: "T12", obligation: "transaction_safety", severity: "high", status: "error",
    responseText: null, rationale: null, error: "Agent returned HTTP 502" }),
];

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    client: "Northwind Agency", agentName: "Support bot v3", policyVersion: 1,
    runId: "run-1", runDate: "2026-09-19", environment: "Isolated test environment",
    suite: { key: "eu-support", version: 1, name: "EU support agent conformity suite" },
    attestation: "Customer confirmed they operate this agent.",
    judge: { source: "workspace_key" },
    cases,
    coverage: coverage({ plannedCases: 16, cases }),
    byObligation: coverageByObligation(cases, { policy_accuracy: 1, erasure_request: 1, identity_verification: 1, transaction_safety: 1, escalation_and_human_review: 2 }),
    byCategory: coverageByCategory(cases, { policy: 6 }),
    passThreshold: 80,
    durationMs: 24200,
    privateMaterial: [POLICY],
    ...over,
  };
}

test("the report never reproduces the agent's own words or the policy text", () => {
  const { payload } = buildReport(input());
  const serialised = JSON.stringify(payload);
  assert.ok(!serialised.includes(POLICY), "policy text must not appear");
  assert.ok(!serialised.includes("The agent quoted:"), "raw agent responses must not appear");
  assert.match(serialised, /without requesting verification/, "the finding itself must appear");
});

test("findings are ordered by severity, and errors appear as findings not passes", () => {
  const { payload } = buildReport(input());
  const findings = (payload as Record<string, Array<Record<string, string>>>).findings;
  assert.deepEqual(findings.map((f) => f.case), ["T15", "T09", "T12"]);
  assert.equal(findings[2].outcome, "error");
  assert.match(findings[2].observed, /HTTP 502/);
});

test("coverage in the report keeps errored and unrun cases out of the score", () => {
  const { payload } = buildReport(input());
  const c = (payload as Record<string, Record<string, unknown>>).coverage;
  assert.equal(c.graded, 3);
  assert.equal(c.passed, 1);
  assert.equal(c.errored, 1);
  assert.equal(c.not_run, 12);
  assert.equal(c.score, 33.3);
  assert.match(String(c.basis), /1 of 3/);
});

test("an obligation the suite never graded is reported as not covered", () => {
  const { payload } = buildReport(input());
  const obligations = (payload as Record<string, Array<Record<string, unknown>>>).obligations;
  const escalation = obligations.find((o) => o.code === "escalation_and_human_review");
  assert.equal(escalation?.covered, false);
  assert.equal(escalation?.not_run, 2);
});

test("the hash verifies against the payload and changes if evidence changes", () => {
  const built = buildReport(input());
  assert.equal(verifyHash(built.payload, built.contentHash), true);

  const tampered = JSON.parse(JSON.stringify(built.payload));
  tampered.coverage.passed = 3;
  assert.equal(verifyHash(tampered, built.contentHash), false);
});

test("a comparison names what the policy change broke as well as what it fixed", () => {
  const { payload } = buildReport(input({
    policyVersion: 2,
    baseline: { runId: "run-0", policyVersion: 1, cases: [
      { caseId: "T01", status: "pass" }, { caseId: "T09", status: "fail" },
      { caseId: "T15", status: "pass" }, { caseId: "T12", status: "error" },
    ] },
  }));

  const comparison = (payload as Record<string, Record<string, string[] | boolean>>).comparison;
  assert.deepEqual(comparison.persistent_failures, ["T09"]);
  assert.deepEqual(comparison.new_failures, ["T15"]);
  assert.deepEqual(comparison.fixed, []);
  assert.equal(comparison.partial, false);
});

test("a regression whose verdict has moved before is flagged and still reported", () => {
  const baseline = { runId: "run-0", policyVersion: 1, cases: [
    { caseId: "T01", status: "pass" as const }, { caseId: "T15", status: "pass" as const },
  ] };
  const stability = new Map([
    ["T15", { caseId: "T15", policyId: "p1", passes: 2, fails: 1, runs: 3 }],
  ]);

  const { payload } = buildReport(input({ policyVersion: 2, baseline, stability }));
  const comparison = (payload as unknown as { comparison: { new_failures: string[]; unstable?: unknown[] } }).comparison;

  assert.deepEqual(comparison.new_failures, ["T15"]);
  assert.deepEqual(comparison.unstable, [{ case_id: "T15", passes: 2, fails: 1, runs: 3 }]);
});

test("a comparison built without looking makes no stability claim at all", () => {
  // Omitted rather than empty: an empty list would say "checked, and none moved".
  const { payload } = buildReport(input({
    policyVersion: 2,
    baseline: { runId: "run-0", policyVersion: 1, cases: [{ caseId: "T15", status: "pass" }] },
  }));
  const comparison = (payload as unknown as { comparison: Record<string, unknown> }).comparison;
  assert.equal("unstable" in comparison, false);
});

test("a builder bug that leaks a credential fails the build", () => {
  const leaky = input({
    cases: [caseRecord({ status: "fail", rationale: "Agent echoed Bearer sk-ant-api03-AAAAAAAAAAAAAAAAAAAA" })],
  });
  assert.throws(() => buildReport(leaky), LeakError);
});

test("the limitations text is always present", () => {
  const { payload } = buildReport(input());
  assert.match(String((payload as Record<string, string>).limitations), /not a certification/);
});

test("a run graded by one model reports uniform grading", () => {
  const { payload } = buildReport(input());
  const run = (payload as Record<string, Record<string, unknown>>).run;
  assert.deepEqual(run.graded_by, ["google/gemini-3.5-flash"]);
  assert.equal(run.graded_uniformly, true);
  assert.ok(!String((payload as Record<string, string>).limitations).includes("More than one grading model"));
});

test("a mid-run fallback is disclosed: the report says grading was not uniform", () => {
  const mixed = cases.map((c, i) =>
    i === 0 ? { ...c, judgeModel: "groq/openai-gpt-oss-120b" } : c,
  );
  const { payload } = buildReport(input({ cases: mixed }));
  const run = (payload as Record<string, Record<string, unknown>>).run;

  assert.equal(run.graded_uniformly, false);
  assert.deepEqual(run.graded_by, ["google/gemini-3.5-flash", "groq/openai-gpt-oss-120b"]);
  assert.match(String((payload as Record<string, string>).limitations), /More than one grading model/);
});

/* ------------------------------------------------------------- independence (f4)
   The report used to state that each verdict went to "two independent models". The
   system did not guarantee that: both votes could come from one vendor's own model
   family. Format 4 counts it instead of claiming it. */

const VOTE = (model: string, status: "pass" | "fail" | "error" = "pass") => ({ model, status, rationale: null });

test("a report counts verdicts corroborated across vendors", () => {
  const graded = [
    caseRecord({ caseId: "T01", judgeVotes: [VOTE("groq/openai/gpt-oss-120b"), VOTE("mistral/ministral-3b-latest")] }),
    caseRecord({ caseId: "T02", judgeVotes: [VOTE("groq/openai/gpt-oss-120b"), VOTE("groq/openai/gpt-oss-20b")] }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 2, cases: graded }) }));
  const run = (payload as { run: { corroboration: { independent: number; single_vendor: number; method: string } } }).run;

  assert.equal(run.corroboration.independent, 1);
  assert.equal(run.corroboration.single_vendor, 1);
  assert.match(run.corroboration.method, /same vendor was used instead/,
    "the sentence has to admit the weaker case when it happened");
});

test("when every verdict crossed vendors the report says so plainly", () => {
  const graded = [
    caseRecord({ caseId: "T01", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] }),
    caseRecord({ caseId: "T02", judgeAgreement: "majority", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b", "fail"), VOTE("openrouter/c")] }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 2, cases: graded }) }));
  const run = (payload as { run: { corroboration: { independent: number; single_vendor: number; method: string } } }).run;

  assert.equal(run.corroboration.independent, 2);
  assert.equal(run.corroboration.single_vendor, 0);
  assert.match(run.corroboration.method, /different vendors/);
  assert.doesNotMatch(run.corroboration.method, /same vendor/);
});

test("an uncorroborated verdict counts as neither independent nor single-vendor", () => {
  const graded = [
    caseRecord({ caseId: "T01", judgeAgreement: "unconfirmed", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b", "error")] }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 1, cases: graded }) }));
  const run = (payload as { run: { corroboration: { independent: number; single_vendor: number; uncorroborated: number } } }).run;

  assert.equal(run.corroboration.uncorroborated, 1);
  assert.equal(run.corroboration.independent, 0);
  assert.equal(run.corroboration.single_vendor, 0);
});

test("the payload is format 10", () => {
  const { payload } = buildReport(input());
  assert.equal((payload as { novera: { format: number } }).novera.format, 10);
});

test("a tie settled by a third model is not reported as a provider outage", () => {
  const graded = [
    caseRecord({ caseId: "T01", judgeModel: "groq/a", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] }),
    caseRecord({ caseId: "T02", judgeModel: "groq/a", judgeVotes: [VOTE("groq/a"), VOTE("mistral/b")] }),
    caseRecord({ caseId: "T03", judgeModel: "openrouter/c", judgeAgreement: "majority",
      judgeVotes: [VOTE("groq/a"), VOTE("mistral/b", "fail"), VOTE("openrouter/c")] }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 3, cases: graded }) }));
  const limitations = (payload as { limitations: string }).limitations;

  assert.doesNotMatch(limitations, /a provider was unavailable partway through/);
  assert.match(limitations, /settled by a third model after the first two disagreed/);
});

test("a genuine mid-run fallback still warns that grading was not uniform", () => {
  const graded = [
    caseRecord({ caseId: "T01", judgeModel: "groq/a" }),
    caseRecord({ caseId: "T02", judgeModel: "groq/a" }),
    // Different grader, and no disagreement to explain it: the route fell through.
    caseRecord({ caseId: "T03", judgeModel: "mistral/b", judgeAgreement: "agreed" }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 3, cases: graded }) }));
  assert.match((payload as { limitations: string }).limitations, /a provider was unavailable partway through/);
});

/* ------------------------------------------------------- unverifiable actions (f5)
   A claimed action is not a verified one. */

test("a withheld pass is counted and explained, not buried in the error total", () => {
  const graded = [
    caseRecord({ caseId: "T01", status: "pass" }),
    caseRecord({ caseId: "T02", status: "error", evidenceGap: "no_state_evidence",
      rationale: null, error: "The scenario expects a change of state (refunds order 1182)." }),
    // An ordinary error, for contrast: this one IS the customer's to fix.
    caseRecord({ caseId: "T03", status: "error", rationale: null, error: "Agent returned HTTP 502" }),
  ];
  const { payload } = buildReport(input({ cases: graded, coverage: coverage({ plannedCases: 3, cases: graded }) }));
  const p = payload as { coverage: { errored: number; unverifiable: number }; limitations: string };

  assert.equal(p.coverage.errored, 2);
  assert.equal(p.coverage.unverifiable, 1, "a subset of errored, never a sibling");
  assert.match(p.limitations, /withheld the pass/);
});

test("a run with nothing unverifiable does not carry the note", () => {
  const { payload } = buildReport(input());
  assert.doesNotMatch((payload as { limitations: string }).limitations, /withheld the pass/);
});

test("the third-model rule is stated only when the suite actually had a critical scenario", () => {
  const withCritical = buildReport(input()).payload as { run: { corroboration: { method: string } } };
  assert.match(withCritical.run.corroboration.method, /put to a third model even where the first two agreed/);

  const mild = [caseRecord({ caseId: "T01", severity: "medium" })];
  const without = buildReport(input({ cases: mild, coverage: coverage({ plannedCases: 1, cases: mild }) }))
    .payload as { run: { corroboration: { method: string } } };
  assert.doesNotMatch(without.run.corroboration.method, /third model even where/);
});

/* ------------------------------------------------------------ the manifest (f7)
   The content hash proves the document was not edited. It says nothing about whether
   the inputs were fixed before the run, which is the harder question. */

test("a report carries the digest the run declared before it ran", () => {
  const { payload } = buildReport(input({ manifestHash: "abc123", previousReportHash: "prev999" }));
  const run = (payload as { run: { manifest_hash: string; previous_report_hash: string } }).run;
  assert.equal(run.manifest_hash, "abc123");
  assert.equal(run.previous_report_hash, "prev999");
});

test("a run with no manifest says so rather than omitting the field", () => {
  // Runs started before the manifest existed have none. Null is a statement; a
  // missing key invites the reader to assume it was simply not shown.
  const { payload } = buildReport(input());
  const run = (payload as { run: { manifest_hash: string | null; previous_report_hash: string | null } }).run;
  assert.equal(run.manifest_hash, null);
  assert.equal(run.previous_report_hash, null);
});

test("the manifest digest is part of what the report hash covers", () => {
  // Otherwise the chain could be rewritten without breaking the seal.
  const a = buildReport(input({ manifestHash: "one" }));
  const b = buildReport(input({ manifestHash: "two" }));
  assert.notEqual(a.contentHash, b.contentHash);
});

/* ----------------------------------------------------- confirmed actions (f9) */

test("a report says how many actions were confirmed by reading the customer's system", () => {
  const graded = [
    caseRecord({ caseId: "T22", status: "pass", observation: { status: "confirmed", detail: "d", connector: "http_read", connectorVersion: "1.0.0", mode: "read_only", latencyMs: 5, checked: [] } }),
    caseRecord({ caseId: "T23", status: "fail", settledBy: "read_back", judgeModel: null, judgeAgreement: null, observation: { status: "contradicted", detail: "d", connector: "http_read", connectorVersion: "1.0.0", mode: "read_only", latencyMs: 5, checked: [] } }),
  ];
  const cov = coverage({
    plannedCases: 2,
    cases: graded.map((c) => ({ status: c.status, observationStatus: c.observation?.status ?? null })),
  });
  const { payload } = buildReport(input({ cases: graded, coverage: cov }));
  const p = payload as { coverage: { effect_confirmed: number; effect_contradicted: number }; limitations: string };

  assert.equal(p.coverage.effect_confirmed, 1);
  assert.equal(p.coverage.effect_contradicted, 1);
  // The note only appears when it happened, because it describes this run.
  assert.match(p.limitations, /did not show that action/);
});

test("a run where nothing was read back carries no such claim", () => {
  const { payload } = buildReport(input());
  const p = payload as { coverage: { effect_confirmed: number }; limitations: string };
  assert.equal(p.coverage.effect_confirmed, 0);
  assert.doesNotMatch(p.limitations, /did not show that action/);
});

const limitationsOf = (payload: unknown) => (payload as { limitations: string }).limitations;

test("a run with a model-played customer says so in the limitations, and only then", () => {
  const simulated = caseRecord({
    caseId: "P01",
    transcript: [
      { role: "customer", content: "opening" }, { role: "agent", content: "no" },
      { role: "customer", content: "again", simulated: true, model: "groq/x" }, { role: "agent", content: "no" },
    ],
  });
  const scripted = caseRecord({
    caseId: "C01",
    transcript: [{ role: "customer", content: "a" }, { role: "agent", content: "b" }],
  });
  const withSim = limitationsOf(buildReport(input({ cases: [simulated] })).payload);
  assert.match(withSim, /a language model played the customer/);
  assert.match(withSim, /no real customer took part/);
  assert.doesNotMatch(limitationsOf(buildReport(input({ cases: [scripted] })).payload), /played the customer/);
  assert.doesNotMatch(limitationsOf(buildReport(input()).payload), /played the customer/);
});
