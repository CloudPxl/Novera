import { test } from "node:test";
import assert from "node:assert/strict";
import { repairFor, type NoVerdictRow } from "../src/lib/evidence/repair.ts";

const row = (over: Partial<NoVerdictRow>): NoVerdictRow => ({
  status: "error", error: null, replied: false, evidenceGap: null, judgeAgreement: null,
  observationStatus: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0, ...over,
});

test("a verdict needs no repair", () => {
  assert.equal(repairFor(row({ status: "pass" })), null);
  assert.equal(repairFor(row({ status: "fail" })), null);
});

test("scenarios Novera never sent say so, and that retrying alone will not help", () => {
  for (const [error, reason] of [
    ["This scenario attempts something irreversible and this agent is marked as production. It was not run.", "production_guard"],
    ["This scenario delivers its input as conversation metadata, and this agent has no {{context}} slot", "no_metadata_slot"],
    ["This scenario is a conversation, and this agent's request template has no {{history}} slot", "no_conversation_slot"],
    ["Not sent: the address resolves to a private or internal address", "not_sent_address"],
  ] as const) {
    const r = repairFor(row({ error }))!;
    assert.equal(r.reason, reason);
    assert.equal(r.agentReceived, "no");
    assert.equal(r.retry, "fix_first");
    assert.equal(r.policyCanHelp, false);
  }
});

test("Novera cutting its own slice is Novera's, and safe to retest when nothing was sent", () => {
  const r = repairFor(row({ error: "Not sent: this run's time slice was ending. This says nothing about the agent; retest the scenario." }))!;
  assert.equal(r.reason, "cut_by_slice");
  assert.equal(r.agentReceived, "no");
  assert.equal(r.retry, "safe");
});

test("an agent that received the scenario and can act is a retry to check first", () => {
  const quiet = repairFor(row({ error: "The agent did not answer within 30 s." }))!;
  assert.equal(quiet.reason, "agent_timeout");
  assert.equal(quiet.agentReceived, "yes");
  assert.equal(quiet.retry, "safe");
  const acting = repairFor(row({ error: "The agent did not answer within 30 s.", actsOnTheWorld: true }))!;
  assert.equal(acting.retry, "check_first");
});

test("the agent's own failures are told apart", () => {
  assert.equal(repairFor(row({ error: "Agent returned HTTP 503" }))!.reason, "agent_http_error");
  assert.match(repairFor(row({ error: "Agent returned HTTP 401" }))!.next, /auth header/);
  assert.equal(repairFor(row({ error: "Agent response was not valid JSON" }))!.reason, "agent_malformed");
  assert.equal(repairFor(row({ error: "No text found at response path \"reply\"." }))!.reason, "agent_response_path");
  assert.equal(repairFor(row({ error: "The agent's reply was larger than 256 KB, so Novera stopped reading it." }))!.reason, "agent_too_large");
  const lost = repairFor(row({ error: "Request failed: fetch failed" }))!;
  assert.equal(lost.reason, "agent_unreachable");
  assert.equal(lost.agentReceived, "unknown");
});

test("an action nothing could check, and a read-back that did not answer, warn that the action may have happened", () => {
  const gap = repairFor(row({ replied: true, evidenceGap: "no_state_evidence", actsOnTheWorld: true }))!;
  assert.equal(gap.reason, "action_not_verified");
  assert.equal(gap.retry, "check_first");
  assert.match(gap.next, /read-only endpoint/);
  const unavailable = repairFor(row({ replied: true, observationStatus: "unavailable", evidenceGap: "no_state_evidence" }))!;
  assert.equal(unavailable.reason, "readback_unavailable");
  assert.equal(unavailable.retry, "check_first");
});

test("graders that could not answer are Novera's, by the router's recorded reason", () => {
  const limited = repairFor(row({ replied: true, error: "No grader could answer: rate limited.", judgeAttempts: [{ ok: false, reason: "rate_limited" }, { ok: false, reason: "rate_limited" }, { ok: false, reason: "timed_out" }] }))!;
  assert.equal(limited.reason, "graders_rate_limited");
  assert.equal(limited.owner, "Novera's graders");
  assert.equal(repairFor(row({ replied: true, judgeAttempts: [{ ok: false, reason: "refused_data_class" }] }))!.reason, "graders_refused_data_class");
  assert.equal(repairFor(row({ replied: true, judgeAttempts: [{ ok: true, reason: "invalid_output" }, { ok: false, reason: "invalid_output" }] }))!.reason, "graders_unreadable");
  assert.equal(repairFor(row({ replied: true, error: "Judge unavailable: boom" }))!.reason, "graders_unavailable");
});

test("an unsettled disagreement goes to a person, and is the one case a clearer expectation can help", () => {
  const r = repairFor(row({ replied: true, judgeAgreement: "unresolved", error: "Two models disagreed (a said pass, b said fail) and a third could not settle it." }))!;
  assert.equal(r.reason, "unsettled_disagreement");
  assert.equal(r.owner, "a person");
  assert.equal(r.policyCanHelp, true);
});

test("anything else is unclassified, never a guess", () => {
  const r = repairFor(row({ error: "Something new went wrong." }))!;
  assert.equal(r.reason, "unclassified");
  assert.match(r.happened, /did not store in a form it can classify/);
});
