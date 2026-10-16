import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CHECK_LABEL, CHECK_LIMIT, LIMIT_UNAVAILABLE, checkVerdict, limitRefusal, parseSingleCheckBody, readSlot, rollingWindow,
  secondsUntil, verdictWords,
} from "../src/lib/checks/single.ts";
import { checkAnswer, checkView, type CheckRow } from "../src/lib/checks/view.ts";
import { DEFAULT_DEPS, productionGuard, runScenarioCheck, type CheckDeps } from "../src/lib/workflow/scenario-check.ts";
import { executeCase } from "../src/lib/runner/execute.ts";
import type { CaseOutcome, SuiteCase } from "../src/lib/runner/types.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { RECENT_DELIVERIES, statusAndLatency } from "../src/lib/webhooks/latency.ts";
import { buildOpenApi } from "../src/lib/api/openapi.ts";
import euSupportV5 from "../data/suites/eu-support-v5.json" with { type: "json" };

const WS = "11111111-1111-4111-8111-111111111111";
const AGENT = "22222222-2222-4222-8222-222222222222";
const SUITE = "33333333-3333-4333-8333-333333333333";
const POLICY = "44444444-4444-4444-8444-444444444444";
const RUN = "55555555-5555-4555-8555-555555555555";
const RUN_CASE = "66666666-6666-4666-8666-666666666666";
const KEY = "77777777-7777-4777-8777-777777777777";
const USER = "88888888-8888-4888-8888-888888888888";

// ---- Request parsing --------------------------------------------------------------------

test("the body is read in snake_case or camelCase, strictly", () => {
  assert.deepEqual(parseSingleCheckBody({ agent_id: AGENT, suite: "eu-support-v5", scenario_id: "T07" }), {
    agentId: AGENT, suiteId: null, suiteRef: "eu-support-v5", scenarioId: "T07", locale: "en",
  });
  assert.deepEqual(parseSingleCheckBody({ agentId: AGENT.toUpperCase(), suiteSlug: "EU-Support-v5", scenarioId: " T07 ", locale: "de" }), {
    agentId: AGENT, suiteId: null, suiteRef: "eu-support-v5", scenarioId: "T07", locale: "de",
  });
  assert.deepEqual(parseSingleCheckBody({ agent_id: AGENT, suite_id: SUITE, scenario_id: "kyc.03" }), {
    agentId: AGENT, suiteId: SUITE, suiteRef: null, scenarioId: "kyc.03", locale: "en",
  });
  const refused: Array<[unknown, RegExp]> = [
    [null, /JSON object/],
    [[], /JSON object/],
    [{ suite: "eu-support", scenario_id: "T07" }, /agent_id/],
    [{ agent_id: "not-an-id", suite: "eu-support", scenario_id: "T07" }, /agent_id/],
    [{ agent_id: AGENT, scenario_id: "T07" }, /Name the suite/],
    [{ agent_id: AGENT, suite: "eu-support", suite_id: SUITE, scenario_id: "T07" }, /Name the suite once/],
    [{ agent_id: AGENT, suite_id: "eu-support", scenario_id: "T07" }, /suite_id/],
    [{ agent_id: AGENT, suite: "eu support!", scenario_id: "T07" }, /suite key/],
    [{ agent_id: AGENT, suite: "eu-support" }, /scenario_id/],
    [{ agent_id: AGENT, suite: "eu-support", scenario_id: "T07; drop" }, /scenario_id/],
    [{ agent_id: AGENT, suite: "eu-support", scenario_id: "T07", locale: "es" }, /locale.*en, de, fr, ro/],
  ];
  for (const [body, why] of refused) {
    const out = parseSingleCheckBody(body);
    assert.ok("error" in out, JSON.stringify(body));
    assert.match(out.error, why, JSON.stringify(body));
  }
});

// ---- A fake database: every call recorded, nothing reachable but the rows given ----------

interface Call { table: string; op: "select" | "insert" | "update" | "delete" | "upsert" }

function fakeDb(rows: Record<string, Array<Record<string, unknown>>>) {
  const calls: Call[] = [];
  const rpcs: string[] = [];
  const inserted: Array<{ table: string; row: Record<string, unknown> }> = [];
  function builder(table: string) {
    const filters: Array<(r: Record<string, unknown>) => boolean> = [];
    let op: Call["op"] = "select";
    let payload: Record<string, unknown> | null = null;
    const result = () => {
      if (op === "insert" && payload) {
        const row = { id: "99999999-9999-4999-8999-999999999999", created_at: "2026-10-16T10:00:00.000Z", ...payload };
        inserted.push({ table, row });
        return [row];
      }
      return (rows[table] ?? []).filter((r) => filters.every((f) => f(r)));
    };
    const b = {
      select() { calls.push({ table, op: op === "insert" ? "insert" : "select" }); return b; },
      insert(p: Record<string, unknown>) { op = "insert"; payload = p; return b; },
      update() { op = "update"; calls.push({ table, op }); return b; },
      delete() { op = "delete"; calls.push({ table, op }); return b; },
      upsert() { op = "upsert"; calls.push({ table, op }); return b; },
      eq(col: string, v: unknown) { filters.push((r) => r[col] === v); return b; },
      neq(col: string, v: unknown) { filters.push((r) => r[col] !== v); return b; },
      is(col: string, v: unknown) { filters.push((r) => (r[col] ?? null) === v); return b; },
      in(col: string, vs: unknown[]) { filters.push((r) => vs.includes(r[col])); return b; },
      or() { return b; },
      not() { return b; },
      order() { return b; },
      limit() { return b; },
      maybeSingle() { return Promise.resolve({ data: result()[0] ?? null, error: null }); },
      single() { const r = result()[0]; return Promise.resolve(r ? { data: r, error: null } : { data: null, error: { message: "no row" } }); },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve({ data: result(), error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  const client = {
    from(table: string) { return builder(table); },
    rpc(name: string) { rpcs.push(name); return Promise.resolve({ data: { allowed: true, remaining: 19, resets_at: "2026-10-16T11:00:00.000Z" }, error: null }); },
  } as unknown as SupabaseClient;
  return { client, calls, rpcs, inserted };
}

const T07 = (euSupportV5.cases as SuiteCase[]).find((c) => c.id === "T07")!;
const T01 = (euSupportV5.cases as SuiteCase[]).find((c) => c.id === "T01")!;
const DESTRUCTIVE: SuiteCase = { ...T01, id: "X01", destructive: true };
const FIXTURE_ONLY: SuiteCase = { ...T01, id: "X02", fixture_only: true };

function world(agent: Partial<Record<string, unknown>> = {}) {
  return fakeDb({
    suites: [{ id: SUITE, key: "eu-support", version: 5, workspace_id: null, approval: "approved", cases: [...(euSupportV5.cases as SuiteCase[]), DESTRUCTIVE, FIXTURE_ONLY] }],
    agents: [{ id: AGENT, workspace_id: WS, config: { kind: "http" }, verification: null, is_production: true, archived_at: null, ...agent }],
    policies: [{ id: POLICY, agent_id: AGENT, workspace_id: WS, version: 3, body: "Refunds within 14 days." }],
    run_cases: [{ id: RUN_CASE, run_id: RUN, workspace_id: WS, case_id: "T07", category: "c", obligation: "o", severity: "high", input: "i", expected: "e", assertions: [] }],
    runs: [{ id: RUN, workspace_id: WS, agent_id: AGENT, suite_id: SUITE, manifest: {} }],
  });
}

const OUTCOME: CaseOutcome = {
  responseText: "Write to jane.doe@example.com and we will refund you.",
  toolActivity: null,
  status: "fail",
  rationale: "The agent told the customer to email jane.doe@example.com instead of escalating.",
  latencyMs: 812,
  usage: null,
  judgeModel: "groq/llama",
  judgeAttempts: [],
  judgeVotes: [{ model: "groq/llama", status: "fail", rationale: "quotes jane.doe@example.com" }, { model: "mistral/small", status: "fail", rationale: null, redacted: true }],
  judgeAgreement: "agreed",
  failedAssertions: ["Escalates to a human"],
  evidenceGap: null,
  settledBy: "models",
  observation: null,
  error: null,
};

function deps(over: Partial<CheckDeps> = {}) {
  const used = { entitlement: 0, takeSlot: 0, grade: 0 };
  const d: CheckDeps = {
    entitlement: async () => { used.entitlement++; return { canRun: true, blocker: null, blockedReason: null, judgeSource: "trial_free" }; },
    takeSlot: async () => { used.takeSlot++; return { allowed: true, remaining: 19, resetsAt: "2026-10-16T11:00:00.000Z" }; },
    grade: async () => { used.grade++; return OUTCOME; },
    ...over,
  };
  return { d, used };
}

// ---- The production guard ----------------------------------------------------------------

test("a destructive or fixture-only scenario is refused against production in the runner's own sentence", async () => {
  const runner = async (c: SuiteCase) => (await executeCase({
    testCase: c, agent: {} as never, policy: "", judge: (() => { throw new Error("x"); }) as never, agentIsProduction: true,
  })).error;
  assert.equal(await productionGuard(DESTRUCTIVE, true), await runner(DESTRUCTIVE));
  assert.equal(await productionGuard(FIXTURE_ONLY, true), await runner(FIXTURE_ONLY));
  assert.match((await productionGuard(DESTRUCTIVE, true)) ?? "", /irreversible.*marked as production/);
  // Unknown is production: the cautious reading.
  assert.equal(await productionGuard(DESTRUCTIVE, null), await runner(DESTRUCTIVE));
  assert.equal(await productionGuard(DESTRUCTIVE, false), null);
  assert.equal(await productionGuard(T07, true), null);

  const db = world();
  const { d, used } = deps();
  const out = await runScenarioCheck({
    client: db.client, workspaceId: WS, userId: USER,
    target: { kind: "suite_case", agentId: AGENT, suiteId: SUITE, suiteRef: null, scenarioId: "X01", locale: "en" },
  }, d);
  assert.equal(out.ok, false);
  if (out.ok) return;
  assert.equal(out.code, "production_guard");
  assert.equal(out.status, 409);
  assert.equal(out.message, await runner(DESTRUCTIVE));
  // Refused before anything was counted, funded, sent or stored.
  assert.deepEqual(used, { entitlement: 0, takeSlot: 0, grade: 0 });
  assert.equal(db.inserted.length, 0);

  // A test target runs it.
  const target = world({ is_production: false });
  const ran = await runScenarioCheck({
    client: target.client, workspaceId: WS, userId: USER,
    target: { kind: "suite_case", agentId: AGENT, suiteId: SUITE, suiteRef: null, scenarioId: "X01", locale: "en" },
  }, deps().d);
  assert.equal(ran.ok, true);
});

// ---- Never a run ---------------------------------------------------------------------------

test("a check writes one case_retests row and nothing to runs, run_cases, reports or the trial", async () => {
  for (const target of [
    { kind: "suite_case" as const, agentId: AGENT, suiteId: SUITE, suiteRef: null, scenarioId: "T07", locale: "en" as const },
    { kind: "run_case" as const, runCaseId: RUN_CASE },
  ]) {
    const db = world();
    const { d, used } = deps();
    const out = await runScenarioCheck({ client: db.client, workspaceId: WS, userId: USER, apiKeyId: KEY, target }, d);
    assert.equal(out.ok, true, JSON.stringify(out));
    assert.deepEqual(used, { entitlement: 1, takeSlot: 1, grade: 1 });
    assert.deepEqual(db.inserted.map((i) => i.table), ["case_retests"]);
    const writes = db.calls.filter((c) => c.op !== "select");
    assert.deepEqual(writes.map((c) => c.table), ["case_retests"]);
    for (const forbidden of ["runs", "run_cases", "reports", "run_requests", "billing_entitlement_grants"]) {
      assert.ok(!writes.some((c) => c.table === forbidden), forbidden);
    }
    const row = db.inserted[0].row;
    assert.equal(row.origin, target.kind);
    assert.equal(row.run_case_id, target.kind === "run_case" ? RUN_CASE : null);
    assert.equal(row.agent_id, AGENT);
    assert.equal(row.suite_id, SUITE);
    assert.equal(row.case_id, "T07");
    assert.equal(row.policy_id, POLICY);
    assert.equal(row.api_key_id, KEY);
    assert.equal(row.judge_source, "trial_free");
    assert.equal(row.responses_returned, false);
    if (out.ok) {
      assert.equal(out.policyVersion, 3);
      assert.equal(out.runId, target.kind === "run_case" ? RUN : null);
    }
  }
  // The real slot taker calls the one rolling-window function and nothing else.
  const db = world();
  assert.deepEqual(await DEFAULT_DEPS.takeSlot(db.client, WS), { allowed: true, remaining: 19, resetsAt: "2026-10-16T11:00:00.000Z" });
  assert.deepEqual(db.rpcs, ["take_scenario_check_slot"]);
});

test("refusals: unknown, archived, unfunded, over the limit, uncounted, and a missing language variant", async () => {
  const run = (target: Parameters<typeof runScenarioCheck>[0]["target"], d: CheckDeps, agent: Record<string, unknown> = {}) =>
    runScenarioCheck({ client: world(agent).client, workspaceId: WS, userId: USER, target }, d);
  const suiteCase = (over: Record<string, unknown> = {}) =>
    ({ kind: "suite_case" as const, agentId: AGENT, suiteId: SUITE, suiteRef: null, scenarioId: "T07", locale: "en" as const, ...over });

  const expect = async (p: ReturnType<typeof run>, code: string, status: number) => {
    const out = await p;
    assert.equal(out.ok, false);
    if (!out.ok) { assert.equal(out.code, code); assert.equal(out.status, status); }
    return out;
  };
  await expect(run(suiteCase({ scenarioId: "T99" }), deps().d), "not_found", 404);
  await expect(run(suiteCase({ agentId: "00000000-0000-4000-8000-000000000000" }), deps().d), "not_found", 404);
  await expect(run({ kind: "run_case", runCaseId: "00000000-0000-4000-8000-000000000000" }, deps().d), "not_found", 404);
  await expect(run(suiteCase(), deps().d, { archived_at: "2026-10-01T00:00:00Z" }), "archived", 409);
  // T01 has no German variant: refused, never sent in English under a German request.
  const noVariant = await expect(run(suiteCase({ scenarioId: "T01", locale: "de" }), deps().d), "no_locale_variant", 422);
  if (!noVariant.ok) assert.match(noVariant.message, /no German variant/);

  const unfunded = deps({ entitlement: async () => ({ canRun: false, blocker: "trial_used", blockedReason: "The trial covers 3 runs.", judgeSource: "trial_free" }) });
  const refusedFunding = await expect(run(suiteCase(), unfunded.d), "not_funded", 409);
  if (!refusedFunding.ok) assert.equal(refusedFunding.blocker, "trial_used");
  assert.equal(unfunded.used.takeSlot, 0);
  // Fair use counts runs; a check is not one, so it is not refused for it.
  for (const blocker of ["concurrency", "fair_use"] as const) {
    const busy = deps({ entitlement: async () => ({ canRun: false, blocker, blockedReason: "busy", judgeSource: "trial_free" }) });
    assert.equal((await run(suiteCase(), busy.d)).ok, true, blocker);
  }

  const full = deps({ takeSlot: async () => ({ allowed: false, remaining: 0, resetsAt: "2026-10-16T10:42:00.000Z" }) });
  const limited = await expect(run(suiteCase(), full.d), "rate_limited", 429);
  if (!limited.ok) assert.equal(limited.resetsAt, "2026-10-16T10:42:00.000Z");
  assert.equal(full.used.grade, 0);

  const uncounted = deps({ takeSlot: async () => null });
  const unavailable = await expect(run(suiteCase(), uncounted.d), "limit_unavailable", 503);
  if (!unavailable.ok) assert.equal(unavailable.message, LIMIT_UNAVAILABLE);
  assert.equal(uncounted.used.grade, 0);

  // A German variant is sent in German.
  let sent: SuiteCase | null = null;
  const de = deps({ grade: async ({ testCase }) => { sent = testCase; return OUTCOME; } });
  assert.equal((await run(suiteCase({ locale: "de" }), de.d)).ok, true);
  assert.ok(sent);
  assert.notEqual((sent as SuiteCase).input, T07.input);
});

// ---- The rolling hour ---------------------------------------------------------------------

test("twenty checks in any rolling hour; the refusal says when the next may start", () => {
  const now = Date.parse("2026-10-16T10:00:00Z");
  const minute = 60_000;
  assert.equal(CHECK_LIMIT.max, 20);
  assert.equal(CHECK_LIMIT.windowSeconds, 3600);

  assert.deepEqual(rollingWindow([], now), { allowed: true, remaining: 19, resetsAt: "2026-10-16T11:00:00.000Z" });
  // Twenty in the last hour, the oldest 50 minutes ago: refused until it is an hour old.
  const twenty = Array.from({ length: 20 }, (_, i) => now - (50 - i) * minute);
  const refused = rollingWindow(twenty, now);
  assert.equal(refused.allowed, false);
  assert.equal(refused.resetsAt, new Date(now + 10 * minute).toISOString());
  // Rolling, not a fixed clock window: ten minutes later the oldest has left and one fits.
  assert.equal(rollingWindow(twenty, now + 10 * minute).allowed, true);
  assert.equal(rollingWindow(twenty, now + 10 * minute).remaining, 0);
  // A slot exactly an hour old is out of the window, as in the database (`<= now() - window`).
  assert.equal(rollingWindow([now - 60 * minute, ...twenty.slice(1)], now).allowed, true);

  assert.equal(secondsUntil("2026-10-16T10:00:00.000Z", now), 1);
  assert.equal(secondsUntil("2026-10-16T10:10:00.000Z", now), 600);
  const sentence = limitRefusal("2026-10-16T10:10:00.000Z", now);
  assert.match(sentence, /20 single-scenario checks in the last hour/);
  assert.match(sentence, /10:10 UTC, in about 10 minutes/);

  assert.deepEqual(readSlot({ allowed: true, remaining: 4, resets_at: "2026-10-16T10:10:00+00:00" }), { allowed: true, remaining: 4, resetsAt: "2026-10-16T10:10:00.000Z" });
  assert.equal(readSlot(null), null);
  assert.equal(readSlot({ allowed: "yes", remaining: 4, resets_at: "x" }), null);
});

test("the database counts the same window under a per-workspace lock", () => {
  const sql = readFileSync("supabase/migrations/0072_scenario_checks.sql", "utf8");
  assert.match(sql, /pg_advisory_xact_lock\(hashtextextended\('scenario-check:' \|\| p_workspace::text, 0\)\)/);
  assert.match(sql, /taken_at <= now\(\) - make_interval\(secs => window_seconds\)/);
  assert.match(sql, /if used >= max_checks then/);
  assert.match(sql, /revoke execute on function take_scenario_check_slot\(uuid, integer, integer\) from public, anon, authenticated/);
  assert.match(sql, /references workspaces \(id\) on delete cascade/);
});

// ---- What a caller is shown ------------------------------------------------------------

const ROW: CheckRow = {
  id: "99999999-9999-4999-8999-999999999999", origin: "suite_case", agent_id: AGENT, case_id: "T07", locale: "en",
  status: "fail", rationale: OUTCOME.rationale, failed_assertions: ["Escalates to a human"], evidence_gap: null,
  settled_by: "models", judge_votes: OUTCOME.judgeVotes, judge_agreement: "agreed", latency_ms: 812, error: null,
  judge_source: "workspace_key", read_back: null, response_text: OUTCOME.responseText, transcript: null,
  created_at: "2026-10-16T10:00:00.000Z",
};

test("the agent's reply is returned only when asked for with the responses scope; quoted personal data is a placeholder otherwise", () => {
  const plain = checkView(ROW, { suite: "eu-support v5", policyVersion: 3, responses: false });
  assert.ok(!("response" in plain));
  assert.ok(!("transcript" in plain));
  const serialised = JSON.stringify(checkAnswer(plain, { remaining: 19, resetsAt: "2026-10-16T11:00:00.000Z" }));
  assert.ok(!serialised.includes("jane.doe@example.com"), serialised);
  assert.ok(!serialised.includes("Write to"), "no reply text");
  assert.equal(plain.verdict, "fail");
  assert.equal(plain.graded_on, "workspace_key");
  assert.deepEqual(plain.graders, [
    { model: "groq/llama", verdict: "fail", read_placeholders: false },
    { model: "mistral/small", verdict: "fail", read_placeholders: true },
  ]);

  const raw = checkView(ROW, { suite: "eu-support v5", policyVersion: 3, responses: true });
  assert.equal(raw.response, OUTCOME.responseText);
  assert.ok(raw.reasons[0].includes("jane.doe@example.com"));

  // The route refuses `include=responses` without the scope before anything runs, and records
  // on the row when the reply was handed to a key.
  const route = readFileSync("src/app/api/v1/probes/single/route.ts", "utf8");
  assert.match(route, /responses && !auth\.caller\.scopes\.includes\("responses"\)/);
  assert.ok(route.indexOf("missing_scope") < route.indexOf("runScenarioCheck({"));
  assert.match(route, /authenticateApiKey\(request, "probe"\)/);
});

test("verdicts: an error and a gap are never a pass", () => {
  assert.deepEqual(checkVerdict({ status: "pass" }), { verdict: "pass", noVerdictReason: null });
  assert.deepEqual(checkVerdict({ status: "fail" }), { verdict: "fail", noVerdictReason: null });
  assert.deepEqual(checkVerdict({ status: "error", judge_agreement: "unresolved" }), { verdict: "no_verdict", noVerdictReason: "disputed" });
  assert.deepEqual(checkVerdict({ status: "error", evidence_gap: "no_tool_evidence" }), { verdict: "no_verdict", noVerdictReason: "no_tool_evidence" });
  assert.deepEqual(checkVerdict({ status: "error" }), { verdict: "error", noVerdictReason: null });
  for (const v of ["fail", "error", "no_verdict"] as const) assert.doesNotMatch(verdictWords(v, "disputed"), /pass/i);
});

test("the label is exact, and every sentence a customer reads keeps the language rule", () => {
  assert.equal(CHECK_LABEL, "Single-scenario check — not a sealed run.");
  const answer = checkAnswer(checkView(ROW, { suite: null, policyVersion: 3, responses: false }), { remaining: 0, resetsAt: "2026-10-16T11:00:00.000Z" });
  assert.equal(answer.label, CHECK_LABEL);
  assert.deepEqual(answer.rate_limit, { remaining: 0, resets_at: "2026-10-16T11:00:00.000Z" });

  const component = readFileSync("src/components/ui/try-scenario-alone.tsx", "utf8");
  assert.match(component, /\{CHECK_LABEL\}/);
  assert.match(component, />\s*Try this scenario alone\s*</);
  const copy = [
    CHECK_LABEL, LIMIT_UNAVAILABLE, limitRefusal("2026-10-16T10:10:00.000Z", Date.parse("2026-10-16T10:00:00Z")),
    ...(["pass", "fail", "error", "no_verdict"] as const).flatMap((v) => [verdictWords(v, "disputed"), verdictWords(v, "no_tool_evidence"), verdictWords(v, "read_back_unavailable")]),
    component,
    readFileSync("src/lib/workflow/scenario-check.ts", "utf8"),
  ].join("\n");
  assert.deepEqual(scanCustomerLanguage(copy), []);
});

test("the endpoint is documented with its scope, codes and label", () => {
  const doc = buildOpenApi() as unknown as { paths: Record<string, { post?: { description: string; responses: Record<string, unknown> } }> };
  const op = doc.paths["/api/v1/probes/single"]?.post;
  assert.ok(op);
  assert.match(op.description, /`probe` scope/);
  assert.match(op.description, /Single-scenario check — not a sealed run\./);
  for (const status of ["200", "400", "403", "404", "409", "422", "429", "401"]) assert.ok(op.responses[status], status);
});

// ---- Webhook latency --------------------------------------------------------------------

test("a delivery shows its status and latency; the guard lets latency move and freezes the rest", () => {
  assert.equal(statusAndLatency(200, 184), "200 · 184 ms");
  assert.equal(statusAndLatency(null, 5003), "5003 ms");
  assert.equal(statusAndLatency(503, 12_345), "503 · 12.3 s");
  assert.equal(statusAndLatency(null, null), "");
  assert.equal(RECENT_DELIVERIES, 10);

  const sql = readFileSync("supabase/migrations/0072_scenario_checks.sql", "utf8");
  assert.match(sql, /moving text\[\] := array\['status', 'attempts', 'last_status', 'last_error', 'last_latency_ms', 'next_attempt_at', 'delivered_at', 'lease_token', 'lease_until'\]/);
  const deliver = readFileSync("src/lib/webhooks/deliver.ts", "utf8");
  assert.match(deliver, /last_latency_ms: latencyMs, delivered_at/);
  assert.match(deliver, /last_status: lastStatus, last_error: why\.slice\(0, 300\), last_latency_ms: latencyMs/);
});

test("checks stay append-only, inside their workspace, and erased before what they name", () => {
  const sql = readFileSync("supabase/migrations/0072_scenario_checks.sql", "utf8");
  assert.match(sql, /refuse_cross_workspace\(\s*'run_case_id', 'run_cases', 'policy_id', 'policies', 'agent_id', 'agents',\s*'suite_id', 'suites', 'api_key_id', 'api_keys'\)/);
  assert.doesNotMatch(sql, /drop trigger if exists case_retests_immutable/);
  // erase_workspace (newest body, 0068) deletes case_retests before the rows it now names.
  const erase = readFileSync("supabase/migrations/0068_contract_acceptances.sql", "utf8");
  const at = (t: string) => erase.indexOf(`delete from ${t} `);
  for (const named of ["api_keys", "policies", "agents", "suites"]) assert.ok(at("case_retests") < at(named), named);
});
