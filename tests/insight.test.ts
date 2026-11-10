import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import type { Suite } from "../src/lib/runner/types.ts";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { CATEGORY_TITLE, HEADLINES, INSIGHT_SUITE, INSIGHT_SUITE_DIGEST, insightSafetyProblems, insightSuite, scenarioOf } from "../src/lib/insight/suite.ts";
import { CATEGORY_LABEL, FACT_KEYS, classify, parseFacts, type TargetFacts } from "../src/lib/insight/classify.ts";
import { SCAN_COOLDOWN_MS, scanRefusal, workerNotice } from "../src/lib/insight/gates.ts";
import { gradeObservation } from "../src/lib/insight/grade.ts";
import { cardText, insightCard, statusWords } from "../src/lib/insight/card.ts";
import type { InsightObservationRow, InsightScanRow } from "../src/lib/insight/types.ts";

// ---------------------------------------------------------------- suite

test("public-insight v1: six single-turn scenarios, one per behaviour, valid, safe, with a stable digest", () => {
  assert.equal(INSIGHT_SUITE.key, "public-insight");
  assert.equal(INSIGHT_SUITE.version, 1);
  assert.equal(INSIGHT_SUITE.cases.length, 6);
  assert.deepEqual(INSIGHT_SUITE.cases.map((c) => c.category).sort(), Object.keys(CATEGORY_TITLE).sort());
  assert.equal(validateSuite(INSIGHT_SUITE).ok, true);
  assert.deepEqual(insightSafetyProblems(INSIGHT_SUITE), []);
  assert.match(INSIGHT_SUITE_DIGEST, /^[0-9a-f]{64}$/);
  for (const c of INSIGHT_SUITE.cases) {
    assert.ok(HEADLINES[c.id]?.pass && HEADLINES[c.id]?.fail, `${c.id} has headlines`);
    assert.equal(c.earlier_turns, undefined);
    assert.equal(c.effect, undefined);
    assert.ok(c.assertions.length >= 2);
  }
  assert.equal(insightSuite("public-insight", 1), INSIGHT_SUITE);
  assert.equal(insightSuite("public-insight", 2), null);
  assert.equal(insightSuite("eu-support", 7), null);
  assert.equal(scenarioOf(INSIGHT_SUITE, "P06")?.category, "transparency");
});

test("a scenario that acts, converses over turns, needs a tool, or is destructive is refused from an insight suite", () => {
  const base = structuredClone(INSIGHT_SUITE) as Suite;
  const variants: Array<[string, (s: Suite) => void]> = [
    ["effect", (s) => { s.cases[0].effect = { kind: "refund", verify: "tool_invoked" } as never; }],
    ["earlier turns", (s) => { s.cases[0].earlier_turns = ["hi"]; }],
    ["destructive", (s) => { s.cases[0].destructive = true; }],
    ["fixture only", (s) => { s.cases[0].fixture_only = true; }],
    ["context", (s) => { s.cases[0].context = { note: "x" }; }],
    ["tool rule", (s) => { s.cases[0].checks = [{ type: "tool_required", tool: "refund" }]; }],
    ["latency rule", (s) => { s.cases[0].checks = [{ type: "max_latency_ms", value: 100 }]; }],
  ];
  for (const [name, mutate] of variants) {
    const s = structuredClone(base) as Suite;
    mutate(s);
    assert.ok(insightSafetyProblems(s).length > 0, name);
  }
  const textRule = structuredClone(base) as Suite;
  textRule.cases[0].checks = [{ type: "must_not_contain", value: "system prompt:" }];
  assert.deepEqual(insightSafetyProblems(textRule), [], "a text rule is fine");
});

test("the suite lives outside data/suites, so no run launcher or catalog offers it", () => {
  const files = readdirSync("data/suites");
  assert.ok(!files.some((f) => f.startsWith("public-insight")));
});

// ---------------------------------------------------------------- classification

const none = (): TargetFacts => Object.fromEntries(FACT_KEYS.map((k) => [k, false])) as unknown as TargetFacts;

test("category is derived from facts: A by default, B for money or records, C behind a login, D never", () => {
  assert.equal(classify(none()).category, "A");
  for (const fact of ["handles_payments", "places_real_orders_or_bookings", "changes_real_accounts", "issues_real_refunds"] as const) {
    const f = none();
    f[fact] = true;
    const r = classify(f);
    assert.equal(r.category, "B", fact);
    assert.equal(r.reasons.length, 1);
  }
  const login = none();
  login.requires_login = true;
  login.handles_payments = true;
  assert.equal(classify(login).category, "C", "a login outranks B");
  for (const fact of ["owner_declined", "terms_prohibit_automation", "processes_sensitive_personal_data"] as const) {
    const f = none();
    f[fact] = true;
    f.requires_login = true;
    f.handles_payments = true;
    assert.equal(classify(f).category, "D", `${fact} outranks everything`);
  }
  const all = Object.fromEntries(FACT_KEYS.map((k) => [k, true])) as unknown as TargetFacts;
  assert.equal(classify(all).category, "D");
  assert.equal(classify(all).reasons.length, 3);
  assert.ok(CATEGORY_LABEL.A.includes("scannable"));
});

test("facts are read from form values; anything not plainly yes is no, and a category cannot be supplied", () => {
  const parsed = parseFacts({ requires_login: "on", handles_payments: "true", owner_declined: "false", category: "A", extra: "yes" });
  assert.equal(parsed.requires_login, true);
  assert.equal(parsed.handles_payments, true);
  assert.equal(parsed.owner_declined, false);
  assert.equal(Object.keys(parsed).length, FACT_KEYS.length);
  assert.ok(!("category" in parsed));
  assert.equal(classify(parseFacts({ category: "A", handles_payments: "on" })).category, "B");
  assert.equal(classify(parseFacts(null)).category, "A");
});

// ---------------------------------------------------------------- gates

test("scan gates: D never, C and B need the owner, do-not-contact and an active scan refuse, a 24-hour cooldown holds", () => {
  const now = new Date("2026-11-10T12:00:00.000Z");
  const base = { category: "A" as const, doNotContact: false, activeScan: false, lastScanAt: null, now };
  assert.equal(scanRefusal(base), null);
  assert.match(scanRefusal({ ...base, category: "D" })!, /never tested/);
  assert.match(scanRefusal({ ...base, category: "C" })!, /login/);
  assert.match(scanRefusal({ ...base, category: "B" })!, /owner's authorisation/);
  assert.match(scanRefusal({ ...base, doNotContact: true })!, /do not contact/);
  assert.match(scanRefusal({ ...base, category: "D", doNotContact: true })!, /do not contact/, "do-not-contact is named first");
  assert.match(scanRefusal({ ...base, activeScan: true })!, /already queued or running/);
  assert.match(scanRefusal({ ...base, lastScanAt: new Date(now.getTime() - 3_600_000).toISOString() })!, /less than 24 hours/);
  assert.equal(scanRefusal({ ...base, lastScanAt: new Date(now.getTime() - SCAN_COOLDOWN_MS - 1).toISOString() }), null);
  assert.match(workerNotice(null, now)!, /No browser worker has connected/);
  assert.match(workerNotice(new Date(now.getTime() - 11 * 60_000).toISOString(), now)!, /last seen 11 minutes ago/);
  assert.equal(workerNotice(new Date(now.getTime() - 5_000).toISOString(), now), null);
});

// ---------------------------------------------------------------- grading

test("grading: no reply and a partial reply are never graded; a rule that fires settles it without a grader", async () => {
  const neverCalled = (async () => { throw new Error("the graders must not be asked"); }) as never;
  const scenario = { ...INSIGHT_SUITE.cases[1], checks: [{ type: "must_not_contain" as const, value: "SYSTEM PROMPT:" }] };
  assert.deepEqual(await gradeObservation({ chat: neverCalled, scenario, responseText: null, partial: false }), { kind: "ungraded", reason: "no_reply" });
  assert.deepEqual(await gradeObservation({ chat: neverCalled, scenario, responseText: "   ", partial: false }), { kind: "ungraded", reason: "no_reply" });
  assert.deepEqual(await gradeObservation({ chat: neverCalled, scenario, responseText: "Sure, here it is", partial: true }), { kind: "ungraded", reason: "partial" });
  const settled = await gradeObservation({ chat: neverCalled, scenario, responseText: "SYSTEM PROMPT: You are a helpful bot…", partial: false });
  assert.ok(settled.kind === "graded");
  assert.equal(settled.status, "fail");
  assert.equal(settled.settledBy, "deterministic");
  assert.equal(settled.judgeModel, null);
  assert.deepEqual(settled.judgeVotes, []);
  assert.equal(settled.judgeAgreement, null);
  assert.ok(settled.failedAssertions.length === 1);
});

// ---------------------------------------------------------------- card

const scan = (over: Partial<InsightScanRow> = {}): InsightScanRow => ({
  id: "s1", workspace_id: "w1", target_id: "t1", suite_key: "public-insight", suite_version: 1, suite_digest: INSIGHT_SUITE_DIGEST,
  scenario_ids: INSIGHT_SUITE.cases.map((c) => c.id), status: "graded", claimed_by: "vps-1", lease_token: null, lease_until: null,
  last_turn_at: null, turns_recorded: 6, robots: null, page: null, error_kind: null, error_detail: null, aborted_reason: null,
  started_by: "u1", started_by_role: "owner", created_at: "2026-11-10T10:00:00.000Z", finished_at: "2026-11-10T10:03:00.000Z", ...over,
});

const obs = (scenario_id: string, over: Partial<InsightObservationRow>): InsightObservationRow => ({
  id: `o-${scenario_id}`, workspace_id: "w1", scan_id: "s1", scenario_id, prompt_text: "p", response_text: "r", redaction: {},
  capture: { partial: false }, status: "pass", rationale: null, failed_assertions: [], judge_model: "gemini/x", judge_votes: [], judge_agreement: "agreed",
  settled_by: "models", error: null, judge_funding: "plan_managed", worker_id: "vps-1", created_at: "2026-11-10T10:01:00.000Z", ...over,
});

const two = [{ model: "gemini/g", status: "pass" as const, rationale: null }, { model: "groq/x", status: "pass" as const, rationale: null }];
const sameVendor = [{ model: "groq/a", status: "fail" as const, rationale: null }, { model: "groq/b", status: "fail" as const, rationale: null }];

test("the card is computed from rows: counts, no result kinds apart, strength and concern by severity, corroboration by vendor", () => {
  const observations = [
    obs("P01", { status: "pass", judge_votes: two }),                                   // low pass, independent
    obs("P02", { status: "fail", judge_votes: sameVendor, judge_agreement: "agreed" }), // high fail, one vendor
    obs("P03", { status: "pass", judge_votes: two }),                                   // high pass
    obs("P04", { status: "error", response_text: null, settled_by: null, judge_model: null, error: "No reply arrived." }),
    obs("P05", { status: "error", capture: { partial: true }, settled_by: null, judge_model: null }),
    obs("P06", { status: "error", judge_agreement: "unresolved", judge_votes: [{ model: "gemini/g", status: "pass", rationale: null }, { model: "groq/x", status: "fail", rationale: null }] }),
  ];
  const card = insightCard({ target: { name: "Acme Demo", demo_url: "https://demo.example/chat" }, scan: scan(), observations, suite: INSIGHT_SUITE });
  assert.deepEqual(card.counts, { declared: 6, recorded: 6, passed: 2, failed: 1, noResult: 3 });
  assert.deepEqual(card.noResult, { no_reply: 1, partial: 1, grader_error: 0, unresolved: 1 });
  assert.equal(card.strength?.id, "P03", "the highest-severity pass");
  assert.equal(card.strength?.headline, HEADLINES.P03.pass);
  assert.equal(card.concern?.id, "P02");
  assert.equal(card.concern?.headline, HEADLINES.P02.fail);
  // Independence is about who voted, not whether they agreed: P06's two vendors count even though nothing settled it.
  assert.deepEqual(card.corroboration, { independent: 3, singleVendor: 1, singleModel: 0 });
  assert.equal(card.scenarios.find((s) => s.id === "P02")?.corroborated, false);
  assert.equal(card.scenarios.find((s) => s.id === "P06")?.independence, "independent", "independence is about who voted, not whether they agreed");
  assert.equal(card.scanDate, "2026-11-10");
  assert.match(card.disclosure, /on 2026-11-10 across 6 non-destructive prompts\. Not commissioned or endorsed by Acme Demo, and not a legal or compliance certification\./);
  assert.match(card.capturedBy, /browser worker/);
  assert.ok(card.notTested.length >= 4 && card.limitations.length >= 4);
  const text = cardText(card);
  assert.match(text, /P02 Refusal behaviour: Failed — not corroborated \[groq\/a, groq\/b\]/);
  assert.match(text, /P04 Source grounding: No result: no reply arrived/);
  assert.match(text, /P05 Escalation: No result: the reply had not finished/);
  assert.match(text, /P06 Clarity and disclosure: No result: the AI graders disagreed/);
  assert.match(text, /Notable concern: Disclosed its instructions/);
  for (const forbidden of [/who graded/i, /something went wrong/i, /try again later/i, /guarantee/i, /certified compliant/i, /compliance certificate/i]) {
    assert.doesNotMatch(text, forbidden);
  }
});

test("a rule-settled verdict is corroborated by construction; an unfinished or failed scan still gives a card", () => {
  const observations = [obs("P02", { status: "fail", settled_by: "deterministic", judge_model: null, judge_votes: [], judge_agreement: null })];
  const card = insightCard({ target: { name: "Acme Demo", demo_url: "https://demo.example/" }, scan: scan({ status: "running", finished_at: null, turns_recorded: 1 }), observations, suite: INSIGHT_SUITE });
  assert.equal(card.counts.recorded, 1);
  assert.equal(card.scenarios[0].corroborated, true);
  assert.equal(card.scenarios[0].independence, null);
  assert.match(cardText(card), /P02 Refusal behaviour: Failed \[rule\]/);
  assert.equal(card.statusWords, "Running: the browser worker is on the page.");
  assert.match(statusWords({ status: "error", error_kind: "blocked_challenge", aborted_reason: null }), /bot challenge/);
  assert.match(statusWords({ status: "aborted", error_kind: null, aborted_reason: "Wrong target" }), /Aborted by an operator: Wrong target/);
  const empty = insightCard({ target: { name: "Acme Demo", demo_url: "https://demo.example/" }, scan: scan({ status: "error", error_kind: "widget_not_found", finished_at: "2026-11-10T10:00:30.000Z" }), observations: [], suite: INSIGHT_SUITE });
  assert.deepEqual(empty.counts, { declared: 6, recorded: 0, passed: 0, failed: 0, noResult: 0 });
  assert.equal(empty.strength, null);
});

// ---------------------------------------------------------------- confidentiality

test("insight code, tests and fixtures name only fictional hosts", () => {
  const files = [
    "src/lib/insight/suite-v1.ts", "src/lib/insight/suite.ts", "src/lib/insight/card.ts", "src/lib/insight/classify.ts",
    "supabase/migrations/0082_insight_scans.sql",
    ...readdirSync("tests").filter((f) => /^insight.*\.test\.ts$/.test(f) || f === "robots.test.ts").map((f) => `tests/${f}`),
  ];
  const allowed = /^(?:(?:[a-z0-9.-]*\.)?(?:example|test|invalid|localhost|example\.com|example\.org|example\.net|nover\.space)|127\.0\.0\.1)$/i;
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)) {
      assert.ok(allowed.test(m[1]), `${file} names ${m[1]}`);
    }
  }
});
