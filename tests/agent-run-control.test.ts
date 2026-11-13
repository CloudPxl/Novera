/**
 * How a run behaves when the agent's platform pushes back or breaks: a limit is waited out and
 * the run slows to one at a time; one cause repeating stops the run only when a check message
 * fails too; a connection that answers nothing usable is found before the first scenario. None of
 * these ever becomes a pass or a fail.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTION_HALT_PREFIX, TRANSPORT_HALT_MESSAGE, executeCase, executeRun, mayResendThrottled, probeBeforeFirst,
} from "../src/lib/runner/execute.ts";
import { isConnectionHalt, ciRunExit } from "../src/lib/ci/gate.ts";
import { abortedReason } from "../src/lib/webhooks/deliver.ts";
import { pacingFor } from "../src/lib/workflow/execute-run.ts";
import type { RunCaseRecord, RunStore, Suite, SuiteCase } from "../src/lib/runner/types.ts";
import type { AgentAdapter, AgentFailure, AgentResult } from "../src/lib/agents/types.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";

const caseOf = (id: string, extra: Partial<SuiteCase> = {}): SuiteCase => ({
  id, category: "policy", obligation: "policy_accuracy", severity: "medium", input: `in ${id}`, expected_behavior: "e", assertions: ["a"], ...extra,
});
const suiteOf = (n: number): Suite => ({ key: "s", version: 1, name: "s", cases: Array.from({ length: n }, (_, i) => caseOf(`S${i + 1}`)) });

function memoryStore() {
  const saved: RunCaseRecord[] = [];
  const finished: Array<{ status: string; error?: string }> = [];
  const store: RunStore = {
    async saveCase(record) { saved.push(record); },
    async markRunning() {},
    async finishRun(_id, outcome) { finished.push(outcome); },
  };
  return { store, saved, finished };
}

const judge: RoutedChat = async () => ({
  text: JSON.stringify({ verdict: "pass", rationale: "fine." }), model: "stub", usage: {}, raw: {},
  servedBy: { connection: "stub", model: "stub-model" }, attempts: [{ connection: "stub", model: "stub-model", ok: true, ms: 1 }],
});

const ok = (text = "a reply"): AgentResult => ({ ok: true, responseText: text, toolActivity: null, latencyMs: 1 });
const failing = (failure: AgentFailure, error: string, statusCode = 200): AgentResult => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 1, statusCode, failure, error });
const LIMIT_429 = failing({ kind: "throttled", signature: "http:429", refusedAtDoor: true }, "Agent returned HTTP 429: the agent's platform refused it as over a limit.", 429);
const LIMIT_STREAM = failing({ kind: "throttled", signature: "stream:too_many_requests" }, 'The agent\'s stream ended with an error before a reply. Its platform said: "too_many_requests: slow down".');
const EMPTY = failing({ kind: "empty", signature: "stream:empty" }, "The agent's stream finished normally and carried no reply text: the agent answered with an empty reply.");
const BAD_INPUT = failing({ kind: "platform_error", signature: "stream:invalid_param" }, 'The agent\'s stream ended with an error before a reply. Its platform said: "invalid_param: customer_tier is required".');

function agentWith(send: (input: string, n: number) => AgentResult, probe: () => AgentResult = () => ok("hello")): AgentAdapter & { sent: string[]; probes: number; times: number[] } {
  const sent: string[] = [];
  const times: number[] = [];
  const agent = {
    sent, times, probes: 0,
    probe: async () => { agent.probes++; return probe(); },
    send: async ({ input }: { input: string }) => { sent.push(input); times.push(Date.now()); return send(input, sent.length); },
    acceptsContext: () => true,
  };
  return agent;
}

test("a 429 is waited out and sent again for any scenario; a limit inside an answer only where it cannot act twice", () => {
  assert.equal(mayResendThrottled(LIMIT_429, caseOf("A", { effect: { kind: "refund" } as never }), 2), true, "refused at the door: nothing acted");
  assert.equal(mayResendThrottled(LIMIT_STREAM, caseOf("A"), 1), true);
  assert.equal(mayResendThrottled(LIMIT_STREAM, caseOf("A", { destructive: true }), 1), false);
  assert.equal(mayResendThrottled(LIMIT_STREAM, caseOf("A"), 2), false, "not mid-conversation");
  assert.equal(mayResendThrottled(EMPTY, caseOf("A"), 1), false);
});

test("a scenario the platform throttled is sent again after the waits and recorded once, with how many attempts", async () => {
  let throttles = 0;
  const agent = agentWith((_i, n) => (n <= 2 ? LIMIT_429 : ok("finally")));
  const outcome = await executeCase({ testCase: caseOf("T1"), agent, policy: "p", judge, onThrottle: () => throttles++, throttleWaitsMs: [5, 5] });
  assert.equal(agent.sent.length, 3);
  assert.equal(outcome.responseText, "finally");
  assert.equal(outcome.status, "pass");
  assert.ok(throttles >= 2, "the run is told each time");

  const still = agentWith(() => LIMIT_429);
  const gaveUp = await executeCase({ testCase: caseOf("T2"), agent: still, policy: "p", judge, throttleWaitsMs: [5, 5] });
  assert.equal(still.sent.length, 3, "two more attempts, then stop");
  assert.equal(gaveUp.status, "error");
  assert.match(gaveUp.error ?? "", /Sent 3 times, waiting .* between, while its platform said it was over a limit\./);
});

test("after a limit the run sends one scenario at a time, every scenario recorded once, never a pass or a fail from the limit", async () => {
  const { store, saved } = memoryStore();
  let inFlight = 0;
  let maxInFlight = 0;
  let calls = 0;
  const sentAt: number[] = [];
  const agent: AgentAdapter = {
    probe: async () => ok("hello"),
    send: async () => {
      const n = ++calls;
      sentAt.push(Date.now());
      inFlight++;
      // Once limited, more than one in flight is what the slow mode prevents.
      if (n > 3) maxInFlight = Math.max(maxInFlight, inFlight);
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
      // The first answer says "over a limit"; everything after is answered.
      return n === 1 ? LIMIT_429 : ok();
    },
    acceptsContext: () => true,
  };
  const summary = await executeRun({ runId: "r", suite: suiteOf(6), agent, policy: "p", judge, store, concurrency: 3, throttleWaitsMs: [20, 20], slowGapStartMs: 40 });
  assert.equal(summary.status, "completed");
  assert.deepEqual(saved.map((r) => r.caseId).sort(), ["S1", "S2", "S3", "S4", "S5", "S6"], "each scenario once");
  assert.ok(saved.every((r) => r.status === "pass"), "the throttled scenario recovered");
  assert.equal(maxInFlight, 1, "one at a time after the limit");
  // The sends that started after the limit was reported are spaced by the slow gap (timer slack allowed).
  const late = sentAt.slice(4);
  for (let i = 1; i < late.length; i++) assert.ok(late[i] - late[i - 1] >= 35, `gap ${late[i] - late[i - 1]} ms between later sends`);
});

test("one cause repeating stops the run only when the check message fails the same way", async () => {
  // The connection itself is broken: every scenario and the check answer invalid_param.
  const broken = memoryStore();
  const agent = agentWith(() => BAD_INPUT, () => BAD_INPUT);
  const summary = await executeRun({ runId: "r", suite: suiteOf(8), agent, policy: "p", judge, store: broken.store, concurrency: 1 });
  assert.equal(summary.status, "aborted");
  assert.ok(summary.error?.startsWith(CONNECTION_HALT_PREFIX));
  assert.match(summary.error ?? "", /failed the same way/);
  assert.match(summary.error ?? "", /customer_tier is required/, "the halt says what the platform said");
  assert.equal(agent.sent.length, 3, "the rest were never sent");
  assert.equal(agent.probes, 1);
  assert.ok(broken.saved.every((r) => r.status === "error"));

  // Three scenarios in a row answered empty, and the check message is answered: about those
  // scenarios, not the connection. The run continues and is not probed for that cause again.
  const fine = memoryStore();
  const branchy = agentWith((input) => (["in S2", "in S3", "in S4", "in S6", "in S7", "in S8"].includes(input) ? EMPTY : ok()));
  const continued = await executeRun({ runId: "r", suite: suiteOf(8), agent: branchy, policy: "p", judge, store: fine.store, concurrency: 1 });
  assert.equal(continued.status, "completed");
  assert.equal(branchy.sent.length, 8);
  assert.equal(branchy.probes, 1);
  assert.equal(fine.saved.filter((r) => r.status === "error").length, 6);
});

test("a success sent after the repeats began ends the streak; one sent before it does not", async () => {
  const { store } = memoryStore();
  const agent = agentWith((input) => (input === "in S3" ? ok() : BAD_INPUT), () => BAD_INPUT);
  const summary = await executeRun({ runId: "r", suite: suiteOf(6), agent, policy: "p", judge, store, concurrency: 1 });
  // S1, S2 fail; S3 succeeds; S4, S5, S6 fail: three in a row again, then the check fails.
  assert.equal(summary.status, "aborted");
  assert.equal(agent.sent.length, 6);
});

test("a run that has recorded nothing proves the connection first, and spends nothing when it fails", async () => {
  const { store, saved, finished } = memoryStore();
  const agent = agentWith(() => ok(), () => failing({ kind: "refused_auth", signature: "http:401", refusedAtDoor: true }, 'Agent returned HTTP 401. Its platform said: "unauthorized: Access token is invalid".', 401));
  const summary = await executeRun({ runId: "r", suite: suiteOf(5), agent, policy: "p", judge, store, probeFirst: true });
  assert.equal(summary.status, "aborted");
  assert.equal(agent.sent.length, 0, "no scenario was sent");
  assert.equal(saved.length, 0, "nothing was recorded");
  assert.match(summary.error ?? "", /^Connection check failed; run halted\. Before the first scenario/);
  assert.match(summary.error ?? "", /Access token is invalid/);
  assert.deepEqual(finished.map((f) => f.status), ["aborted"]);

  // Answered: the run goes on, and a later slice (something recorded) does not check again.
  const good = agentWith(() => ok());
  const ran = await executeRun({ runId: "r", suite: suiteOf(2), agent: good, policy: "p", judge, store: memoryStore().store, probeFirst: true });
  assert.equal(ran.status, "completed");
  assert.equal(good.probes, 1);
  const later = agentWith(() => ok());
  await executeRun({ runId: "r", suite: suiteOf(2), agent: later, policy: "p", judge, store: memoryStore().store, probeFirst: true, skipCaseIds: ["S1"] });
  assert.equal(later.probes, 0);
});

test("the first check gives a limit or a cold start one more chance", async () => {
  let n = 0;
  const agent = agentWith(() => ok(), () => (++n === 1 ? LIMIT_429 : ok("hello")));
  assert.equal(await probeBeforeFirst(agent, undefined, 5), null);
  assert.equal(agent.probes, 2);
  let m = 0;
  const flakyStep = agentWith(() => ok(), () => (++m === 1 ? failing({ kind: "platform_error", signature: "stream:node_failed:http-request", transient: true }, "A step of the agent's workflow failed and no reply followed.") : ok("hello")));
  assert.equal(await probeBeforeFirst(flakyStep, undefined, 5), null, "a workflow step failing once does not stop the run");
  const down = agentWith(() => ok(), () => failing({ kind: "unreachable", signature: "unreachable:econnrefused" }, "Request failed: connect ECONNREFUSED"));
  const said = await probeBeforeFirst(down, undefined, 5);
  assert.match(said ?? "", /ECONNREFUSED/);
  assert.equal(down.probes, 2);
});

test("a limit that never lifts still ends the run as unreachable or rate-limited, saying what the platform said", async () => {
  const { store } = memoryStore();
  const agent = agentWith(() => LIMIT_STREAM);
  const summary = await executeRun({ runId: "r", suite: suiteOf(6), agent, policy: "p", judge, store, concurrency: 1, throttleWaitsMs: [5, 5], slowGapStartMs: 5 });
  assert.equal(summary.status, "aborted");
  assert.ok(summary.error?.startsWith(TRANSPORT_HALT_MESSAGE));
  assert.match(summary.error ?? "", /The agent's platform said: "too_many_requests: slow down"\./);
});

test("the CI gate and a webhook read a connection halt as configuration, never as a finding", () => {
  const error = `${CONNECTION_HALT_PREFIX} Before the first scenario, …`;
  assert.equal(isConnectionHalt(error), true);
  assert.equal(ciRunExit({ status: "aborted", error, report: null }).code, 3);
  assert.match(abortedReason({ error, stopped_by: null }), /connection gave no usable reply/);
  assert.equal(isConnectionHalt(TRANSPORT_HALT_MESSAGE), false);
});

test("a connection's own pacing is honoured within 250 ms … 10 s", () => {
  assert.equal(pacingFor({ kind: "http" }), 250);
  assert.equal(pacingFor({ kind: "http", paceMs: 2000 }), 2000);
  assert.equal(pacingFor({ kind: "http", paceMs: 10 }), 250);
  assert.equal(pacingFor({ kind: "http", paceMs: 60_000 }), 10_000);
  assert.equal(pacingFor({ kind: "model", paceMs: 2000 }), 250);
  assert.equal(pacingFor(null), 250);
});

test("one at a time, when the connection says so", async () => {
  let inFlight = 0;
  let max = 0;
  const agent: AgentAdapter = {
    probe: async () => ok(),
    send: async () => { inFlight++; max = Math.max(max, inFlight); await new Promise((r) => setTimeout(r, 5)); inFlight--; return ok(); },
    acceptsContext: () => true,
  };
  await executeRun({ runId: "r", suite: suiteOf(5), agent, policy: "p", judge, store: memoryStore().store, oneAtATime: true });
  assert.equal(max, 1);
});

test("a workflow step that failed is sent once more, and only where sending twice cannot act twice", async () => {
  const STEP = failing({ kind: "platform_error", signature: "stream:node_failed:http-request", transient: true }, 'A step of the agent\'s workflow failed and no reply followed. Its platform said: "[http-request] Order lookup: 502".');
  const flaky = agentWith((_i, n) => (n === 1 ? STEP : ok("recovered")));
  const recovered = await executeCase({ testCase: caseOf("W1"), agent: flaky, policy: "p", judge, retryAfterMs: 5 });
  assert.equal(flaky.sent.length, 2);
  assert.equal(recovered.status, "pass");

  const acts = agentWith(() => STEP);
  const kept = await executeCase({ testCase: caseOf("W2", { effect: { kind: "refund" } as never }), agent: acts, policy: "p", judge, retryAfterMs: 5 });
  assert.equal(acts.sent.length, 1, "a scenario that may act is never sent again by Novera alone");
  assert.equal(kept.status, "error");

  const twice = agentWith(() => STEP);
  const both = await executeCase({ testCase: caseOf("W3"), agent: twice, policy: "p", judge, retryAfterMs: 5 });
  assert.equal(twice.sent.length, 2);
  assert.equal(both.status, "error", "a step failing twice is still no result, never a fail");
  assert.match(both.error ?? "", /on two attempts/);
});
