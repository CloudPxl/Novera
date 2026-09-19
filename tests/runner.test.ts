import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRun } from "../src/lib/runner/execute.ts";
import type { RunCaseRecord, RunStore, Suite } from "../src/lib/runner/types.ts";
import type { AgentAdapter, AgentResult } from "../src/lib/agents/types.ts";
import type { Provider } from "../src/lib/providers/types.ts";

const suite: Suite = {
  key: "test", version: 1, name: "test suite",
  cases: [
    { id: "C1", category: "policy", obligation: "policy_accuracy", severity: "medium",
      input: "in1", expected_behavior: "exp1", assertions: ["a1"] },
    { id: "C2", category: "tool_safety", obligation: "erasure_request", severity: "high",
      input: "in2", expected_behavior: "exp2", assertions: ["a2"] },
    { id: "C3", category: "identity", obligation: "identity_verification", severity: "high",
      input: "in3", expected_behavior: "exp3", assertions: ["a3"] },
  ],
};

function memoryStore() {
  const saved: RunCaseRecord[] = [];
  const events: string[] = [];
  const store: RunStore = {
    async saveCase(record) { saved.push(record); },
    async markRunning() { events.push("running"); },
    async finishRun(_id, outcome) { events.push(`finished:${outcome.status}`); },
  };
  return { store, saved, events };
}

function agentReturning(byInput: Record<string, Partial<AgentResult>>): AgentAdapter {
  const make = (input: string): AgentResult => ({
    ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 12,
    ...byInput[input],
  });
  return { probe: async () => make("probe"), send: async ({ input }) => make(input) };
}

function judgeReturning(verdicts: Record<string, "pass" | "fail">, calls: string[] = []): Provider {
  return {
    id: "anthropic", label: "stub",
    async chat(request) {
      const body = request.messages[0].content;
      const caseId = Object.keys(verdicts).find((id) => body.includes(`reply to in${id.slice(1)}`)) ?? "?";
      calls.push(caseId);
      return {
        text: JSON.stringify({ verdict: verdicts[caseId] ?? "pass", rationale: "because." }),
        model: "stub", usage: {}, raw: {},
      };
    },
  };
}

const judgeArgs = (provider: Provider) => ({ provider, apiKey: "k", model: "m" });

test("a dead endpoint on one case does not cost the rest of the run", async () => {
  const { store, saved, events } = memoryStore();
  const agent = agentReturning({
    in2: { ok: false, responseText: null, error: "ECONNREFUSED" },
  });

  const summary = await executeRun({
    runId: "r1", suite, agent, policy: "p", judge: judgeArgs(judgeReturning({ C1: "pass", C3: "fail" })), store, concurrency: 1,
  });

  assert.equal(summary.status, "completed");
  assert.equal(saved.length, 3);
  assert.deepEqual(events, ["running", "finished:completed"]);

  const byId = Object.fromEntries(summary.cases.map((c) => [c.caseId, c]));
  assert.equal(byId.C1.status, "pass");
  assert.equal(byId.C2.status, "error");
  assert.equal(byId.C3.status, "fail");
  assert.match(byId.C2.error ?? "", /ECONNREFUSED/);
});

test("the judge is never asked to grade a response that does not exist", async () => {
  const calls: string[] = [];
  const { store } = memoryStore();
  const agent = agentReturning({ in2: { ok: false, responseText: null, error: "timeout" } });

  await executeRun({
    runId: "r2", suite, agent, policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C3: "pass" }, calls)), store, concurrency: 1,
  });

  assert.deepEqual(calls.sort(), ["C1", "C3"], "C2 must not reach the judge");
});

test("an errored case is excluded from the score and reported separately", async () => {
  const { store } = memoryStore();
  const agent = agentReturning({ in3: { ok: false, responseText: null, error: "HTTP 500" } });

  const summary = await executeRun({
    runId: "r3", suite, agent, policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "fail" })), store, concurrency: 2,
  });

  assert.equal(summary.coverage.planned, 3);
  assert.equal(summary.coverage.graded, 2);
  assert.equal(summary.coverage.errored, 1);
  assert.equal(summary.coverage.score, 50);
  assert.equal(summary.coverage.notRun, 0);
});

test("obligation coverage marks an obligation with no graded case as not covered", async () => {
  const { store } = memoryStore();
  const agent = agentReturning({ in2: { ok: false, responseText: null, error: "down" } });

  const summary = await executeRun({
    runId: "r4", suite, agent, policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C3: "pass" })), store, concurrency: 3,
  });

  const byCode = Object.fromEntries(summary.byObligation.map((o) => [o.obligation, o]));
  assert.equal(byCode.erasure_request.covered, false);
  assert.equal(byCode.erasure_request.errored, 1);
  assert.equal(byCode.identity_verification.covered, true);
});

test("the approved policy reaches the agent on every case", async () => {
  const seen: string[] = [];
  const { store } = memoryStore();
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "x", toolActivity: null, latencyMs: 1 }),
    send: async ({ input, policy }) => {
      seen.push(policy);
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1 };
    },
  };

  await executeRun({
    runId: "r5", suite, agent, policy: "policy v2 text",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "pass", C3: "pass" })), store, concurrency: 1,
  });

  assert.deepEqual(seen, ["policy v2 text", "policy v2 text", "policy v2 text"]);
});

test("a store failure aborts the run but keeps the evidence already written", async () => {
  const saved: RunCaseRecord[] = [];
  let finished: string | null = null;
  const store: RunStore = {
    async saveCase(record) {
      if (record.caseId === "C2") throw new Error("database unavailable");
      saved.push(record);
    },
    async markRunning() {},
    async finishRun(_id, outcome) { finished = outcome.status; },
  };

  const summary = await executeRun({
    runId: "r6", suite, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "pass", C3: "pass" })), store, concurrency: 1,
  });

  assert.equal(summary.status, "aborted");
  assert.match(summary.error ?? "", /database unavailable/);
  assert.equal(finished, "aborted");
  assert.deepEqual(saved.map((c) => c.caseId), ["C1"]);
});
