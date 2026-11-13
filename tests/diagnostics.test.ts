import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CATEGORIES, CATEGORY_ORDER, categoryCounts, categoryFor, diagnose, gradersAttempted, maskTargetUrl, reportCategory,
  type NoResultCategory,
} from "../src/lib/evidence/diagnostics.ts";
import { repairFor, type NoVerdictRow, type RepairReason } from "../src/lib/evidence/repair.ts";

const REASONS: RepairReason[] = [
  "production_guard", "no_metadata_slot", "no_conversation_slot", "cut_by_slice", "not_sent_address", "agent_timeout",
  "agent_too_large", "agent_http_error", "agent_malformed", "agent_rate_limited", "agent_platform_error", "agent_blocked_page",
  "agent_stream_repeats", "agent_response_path", "agent_unreachable", "readback_unavailable",
  "action_not_verified", "unsettled_disagreement", "graders_rate_limited", "graders_timed_out", "graders_refused_data_class",
  "graders_unreadable", "graders_unavailable", "unclassified",
];

test("every reason repairFor can return has a category, and the list here is the whole union", () => {
  const src = readFileSync("src/lib/evidence/repair.ts", "utf8");
  const union = /export type RepairReason =([\s\S]*?);/.exec(src)![1].match(/"([a-z_]+)"/g)!.map((s) => s.slice(1, -1));
  assert.deepEqual([...union].sort(), [...REASONS].sort());
  for (const r of REASONS) assert.ok(CATEGORIES[categoryFor(r)], r);
});

test("grading failures belong to whoever funded the grading", () => {
  for (const r of ["graders_rate_limited", "graders_timed_out", "graders_unavailable", "graders_unreadable"] as RepairReason[]) {
    assert.equal(categoryFor(r, { ownKey: false }), "BLOCKED_NOVERA", r);
    assert.equal(categoryFor(r, { ownKey: true }), "BLOCKED_CONFIG", r);
  }
  assert.equal(categoryFor("production_guard"), "NOT_RUN");
  assert.equal(categoryFor("agent_timeout"), "COULD_NOT_COMPLETE");
  assert.equal(categoryFor("unsettled_disagreement"), "INCONCLUSIVE");
  assert.equal(categoryFor("agent_response_path"), "BLOCKED_CONFIG");
});

test("a withdrawn or expired report is its own category; a current one has none", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(reportCategory({ withdrawnAt: "2026-11-01T00:00:00Z", expiresAt: null }, now), "WITHDRAWN_EXPIRED");
  assert.equal(reportCategory({ withdrawnAt: null, expiresAt: "2026-11-09T11:59:59Z" }, now), "WITHDRAWN_EXPIRED");
  assert.equal(reportCategory({ withdrawnAt: null, expiresAt: "2026-12-09T00:00:00Z" }, now), null);
});

test("the target address keeps scheme and host only: no path, query, credentials or fragment", () => {
  assert.equal(maskTargetUrl("https://user:pass@agent.example.com/tenants/acme/chat?token=s3cret#x"), "https://agent.example.com/…");
  assert.equal(maskTargetUrl("https://agent.example.com"), "https://agent.example.com");
  assert.equal(maskTargetUrl("not a url"), null);
  assert.equal(maskTargetUrl(null), null);
});

test("grader attempts keep the router's reasons, and one vendor behind two connections is one vendor", () => {
  const g = gradersAttempted([
    { connection: "gemini", model: "gemini-3.8-flash", ok: true, ms: 1800 },
    { connection: "groq", model: "openai/gpt-oss-20b", ok: false, reason: "rate_limited", ms: 40 },
    { connection: "mistral", model: "ministral-8b-latest", ok: false, reason: "paced", ms: 0 },
    { connection: "groq", model: "openai/gpt-oss-120b", ok: true, reason: "invalid_output", ms: 900 },
    { connection: "openrouter", model: "x", ok: false, reason: "timed_out" },
  ]);
  assert.deepEqual(g.map((x) => x.status), ["answered", "rate_limited", "not_asked", "unreadable", "timed_out"]);
  assert.equal(g[0].provider, "google");
  assert.equal(g[0].model, "gemini/gemini-3.8-flash");
  assert.equal(g[4].ms, null);
  assert.deepEqual(gradersAttempted("nonsense"), []);
});

const base: NoVerdictRow = {
  status: "error", error: null, replied: false, evidenceGap: null, judgeAgreement: null, observationStatus: null,
  judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0,
};
const input = (row: NoVerdictRow, extra: Partial<Parameters<typeof diagnose>[0]> = {}) => ({
  runId: "run-1", caseRowId: "case-1", scenarioId: "T36", row, repair: repairFor(row)!, ownKey: false,
  runStartedAt: "2026-11-09T10:00:00Z", recordedAt: "2026-11-09T10:01:00Z", latencyMs: 30_000,
  agentUrl: "https://agent.example.com/v1/chat?key=abc", agentTimeoutMs: 30_000, retestsRecorded: 0,
  replyFingerprintStored: false, reportSealed: true, ...extra,
});

test("an agent timeout: facts from stored fields, a medium-confidence cause, unknowns about what the agent did", () => {
  const row = { ...base, error: "The agent did not answer within 30 s." };
  const d = diagnose(input(row));
  assert.equal(d.category, "COULD_NOT_COMPLETE");
  assert.equal(d.observedFacts.stageReached, "target_invocation");
  assert.equal(d.observedFacts.targetUrlMasked, "https://agent.example.com/…");
  assert.doesNotMatch(JSON.stringify(d), /key=abc/);
  assert.equal(d.likelyCause.confidence, "medium");
  assert.ok(d.knownUnknowns.some((u) => /finished the work after Novera stopped waiting/.test(u)));
  assert.equal(d.retryPolicy.isSafeToRetry, true);
  assert.equal(d.noveraAction.automatedResolutionAttempted, false);
  assert.match(d.headline, /^Could not complete: /);
});

test("an agent that can act makes a timeout's retest something to check first", () => {
  const d = diagnose(input({ ...base, error: "The agent did not answer within 30 s.", actsOnTheWorld: true }));
  assert.equal(d.retryPolicy.isSafeToRetry, false);
  assert.match(d.retryPolicy.reasonIfBlocked ?? "", /may already have acted/);
  assert.equal(d.userAction.urgency, "immediate");
});

test("graders rate-limited on Novera's keys: Novera's side, nothing for the customer to fix, a delay before retesting", () => {
  const row = { ...base, replied: true, error: "No grader could answer", judgeAttempts: [
    { connection: "gemini", model: "gemini-3.8-flash", ok: false, reason: "rate_limited" },
    { connection: "groq", model: "openai/gpt-oss-20b", ok: false, reason: "rate_limited" },
  ] };
  const d = diagnose(input(row));
  assert.equal(d.category, "BLOCKED_NOVERA");
  assert.equal(d.userAction.required, false);
  assert.equal(d.likelyCause.confidence, "high");
  assert.equal(d.retryPolicy.recommendedDelayMs, 60_000);
  assert.equal(d.noveraAction.automatedResolutionAttempted, true);
  assert.match(d.noveraAction.details, /2 grader requests in turn \(google, groq\)/);
  // The same failure on the workspace's own key is that key's problem.
  assert.equal(diagnose(input(row, { ownKey: true })).category, "BLOCKED_CONFIG");
});

test("an error Novera never classified claims no cause", () => {
  const d = diagnose(input({ ...base, error: "Something odd" }));
  assert.equal(d.reason, "unclassified");
  assert.equal(d.likelyCause.confidence, "low");
  assert.equal(d.likelyCause.hypothesis, "Not determined from the stored rows.");
  assert.equal(d.observedFacts.storedError, "Something odd");
});

test("no diagnosis says a person reviewed anything, that anyone was alerted, or that a result passed", () => {
  const all = REASONS.map((r) => {
    const row: NoVerdictRow = { ...base, replied: r.startsWith("graders") || r === "unsettled_disagreement" || r === "unclassified",
      error: r === "agent_timeout" ? "did not answer within" : r === "unclassified" ? "x" : null,
      judgeAgreement: r === "unsettled_disagreement" ? "unresolved" : null,
      judgeAttempts: r.startsWith("graders") ? [{ ok: false, reason: r.replace("graders_", "").replace("unreadable", "invalid_output").replace("unavailable", "provider_error").replace("refused_data_class", "refused_data_class") }] : [] };
    const repair = repairFor(row);
    return repair ? diagnose({ ...input(row), repair }) : null;
  }).filter(Boolean);
  assert.ok(all.length >= 10);
  const text = JSON.stringify(all) + JSON.stringify(CATEGORIES);
  assert.doesNotMatch(text, /\b(alerted|paged|notified|engineering team|human review|reviewed by|audited by|passed)\b/i);
});

test("categories count in the order a reader acts on them", () => {
  const cats: NoResultCategory[] = ["BLOCKED_NOVERA", "BLOCKED_CONFIG", "BLOCKED_NOVERA", "INCONCLUSIVE"];
  assert.deepEqual(categoryCounts(cats), [
    { category: "BLOCKED_CONFIG", count: 1 }, { category: "INCONCLUSIVE", count: 1 }, { category: "BLOCKED_NOVERA", count: 2 },
  ]);
  assert.equal(CATEGORY_ORDER.length, Object.keys(CATEGORIES).length);
});

test("a redirect or a refused credential from the agent is configuration; another status is an unreadable result", () => {
  const at = (error: string) => diagnose(input({ ...base, error }));
  assert.equal(at("Agent returned HTTP 308, a redirect to https://www.example.com/chat.").category, "BLOCKED_CONFIG");
  assert.equal(at("Agent returned HTTP 401").category, "BLOCKED_CONFIG");
  assert.equal(at("Agent returned HTTP 403").category, "BLOCKED_CONFIG");
  assert.equal(at("Agent returned HTTP 500").category, "RESULT_UNAVAILABLE");
  assert.equal(at("Agent returned HTTP 500").observedFacts.httpStatus, 500);
});

test("a grading slice that ran out after the agent replied: the agent received it, the stage is grading, the unknown is the grade", () => {
  const row = { ...base, replied: true, error: "No grader could answer: gemini/gemini-3.8-flash did not answer in time; groq/openai/gpt-oss-20b was not asked: the run's time slice was ending." };
  const repair = repairFor(row)!;
  assert.equal(repair.reason, "cut_by_slice");
  assert.equal(repair.agentReceived, "yes", "a stored reply settles whether the agent received it");
  const d = diagnose({ ...input(row), repair });
  assert.equal(d.category, "BLOCKED_NOVERA");
  assert.equal(d.observedFacts.stageReached, "grader_consensus");
  assert.match(d.knownUnknowns[0], /How the reply would have been graded/);
  assert.doesNotMatch(d.likelyCause.supportingEvidence, /held the scenario back/);
  // Without a reply, the slice cut the exchange itself.
  const unsent = diagnose(input({ ...base, error: "Not sent: the run's time slice was ending." }));
  assert.equal(unsent.observedFacts.stageReached, "target_invocation");
  assert.equal(unsent.observedFacts.agentReceived, "no");
});
