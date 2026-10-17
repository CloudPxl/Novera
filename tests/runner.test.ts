import { test } from "node:test";
import assert from "node:assert/strict";
import { executeRun } from "../src/lib/runner/execute.ts";
import type { RunCaseRecord, RunStore, Suite } from "../src/lib/runner/types.ts";
import type { AgentAdapter, AgentResult } from "../src/lib/agents/types.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";

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
  return {
    probe: async () => make("probe"),
    send: async ({ input }) => make(input),
    acceptsContext: () => true,
  };
}

function judgeReturning(
  verdicts: Record<string, "pass" | "fail">,
  calls: string[] = [],
  tasks: string[] = [],
): RoutedChat {
  return async (task, request) => {
    const body = request.messages[0].content;
    const caseId = Object.keys(verdicts).find((id) => body.includes(`reply to in${id.slice(1)}`)) ?? "?";
    calls.push(caseId);
    tasks.push(task);
    return {
      text: JSON.stringify({ verdict: verdicts[caseId] ?? "pass", rationale: "because." }),
      model: "stub",
      usage: {},
      raw: {},
      servedBy: { connection: "stub", model: "stub-model" },
      attempts: [{ connection: "stub", model: "stub-model", ok: true, ms: 1 }],
    };
  };
}

const judgeArgs = (chat: RoutedChat) => chat;

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

  assert.deepEqual([...new Set(calls)].sort(), ["C1", "C3"], "C2 must not reach the judge");
  // Each gradable case is put to two models, which is what makes a verdict a
  // finding rather than one model's opinion.
  assert.equal(calls.filter((c) => c === "C1").length, 2, "C1 must be corroborated");
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
    acceptsContext: () => true,
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

test("a run that runs out of time is resumable, not failed", async () => {
  const { store, saved, events } = memoryStore();

  // A deadline already in the past: nothing should be started at all.
  const first = await executeRun({
    runId: "r9", suite, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "pass", C3: "pass" })),
    store, concurrency: 1, deadline: Date.now() - 1,
  });

  assert.equal(first.status, "incomplete");
  assert.equal(saved.length, 0);
  // Crucially the run is NOT finished: finishing it would publish a report over
  // evidence that does not exist yet.
  assert.ok(!events.some((e) => e.startsWith("finished:")), "an incomplete run must not be finished");
});

test("resuming never re-sends a case the agent already answered", async () => {
  const sent: string[] = [];
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "ok", toolActivity: null, latencyMs: 1 }),
    acceptsContext: () => true,
    send: async ({ input }) => {
      sent.push(input);
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1 };
    },
  };
  const { store, saved } = memoryStore();

  const summary = await executeRun({
    runId: "r10", suite, agent, policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "pass", C3: "pass" })),
    store, concurrency: 1, skipCaseIds: ["C1", "C2"],
  });

  // A second verdict over the same scenario would be new evidence quietly replacing
  // old evidence, which is exactly what the append-only storage exists to prevent.
  assert.deepEqual(sent, ["in3"], "only the ungraded case is sent");
  assert.equal(saved.length, 1);
  assert.equal(summary.status, "completed");
});

test("a case already under way is finished rather than abandoned at the deadline", async () => {
  const { store, saved } = memoryStore();

  // A real agent takes time; the in-memory stub does not, so it is slowed until the
  // deadline can land where this test needs it to.
  const slowAgent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "ok", toolActivity: null, latencyMs: 1 }),
    acceptsContext: () => true,
    send: async ({ input }) => {
      await new Promise((r) => setTimeout(r, 40));
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 40 };
    },
  };

  const summary = await executeRun({
    runId: "r11", suite, agent: slowAgent, policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass", C2: "pass", C3: "pass" })),
    store, concurrency: 1,
    // Enough time to begin one case, not enough to get through three.
    deadline: Date.now() + 50,
  });

  // Whatever it started, it saved: a half-graded case is never left in the database.
  assert.ok(saved.length < 3, "the deadline must actually stop it");
  for (const record of saved) {
    assert.ok(record.status === "pass" || record.status === "fail" || record.status === "error");
  }
  assert.equal(summary.status, "incomplete");
});

/* ------------------------------------------------------- vendor quota exhaustion
   A rate limit says nothing about the agent, so it must not be reported as though it
   did. "Errored" reads as WITHHELD — go and fix something. "Not run" reads as
   INCOMPLETE — run it again — which is the true advice when a free tier is spent. */

/** A router where every candidate refuses on quota, the way an exhausted tier does. */
const allRateLimited: RoutedChat = async () => {
  const error = new Error("every candidate failed") as Error & { attempts: unknown[] };
  error.attempts = [
    { connection: "groq", model: "a", ok: false, error: "Rate limit reached for model `a`", ms: 3 },
    { connection: "mistral", model: "b", ok: false, error: "openai-compatible: Rate limit exceeded", ms: 2 },
  ];
  throw error;
};

test("a run stops starting cases once every vendor is rate-limited", async () => {
  const { store, saved, events } = memoryStore();
  const summary = await executeRun({
    runId: "r1", suite, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(allRateLimited), store, concurrency: 1,
  });

  // Two cases prove the pattern; the third is never sent to the agent at all.
  assert.equal(saved.length, 2, "stopped after two consecutive quota failures");
  assert.equal(summary.coverage.notRun, 1);
  assert.equal(summary.status, "incomplete");
  assert.match(summary.error ?? "", /rate-limited/);
  assert.match(summary.error ?? "", /not run rather than as failures/);
  // Deliberately NOT finished: an incomplete run stays running, so nothing can
  // publish a report over the part of the suite that did execute.
  assert.ok(!events.some((e) => e.startsWith("finished:")), events.join(","));
});

test("an ordinary error does not stop the run, however many there are", async () => {
  // Only a rate limit on *every* attempt counts. A dead agent is a finding about the
  // agent, and the run must keep going and report it.
  const { store, saved } = memoryStore();
  const dead: AgentAdapter = {
    probe: async () => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 1, error: "HTTP 502" }),
    acceptsContext: () => true,
    send: async () => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 1, error: "HTTP 502" }),
  };
  const summary = await executeRun({
    runId: "r2", suite, agent: dead, policy: "p",
    judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });
  assert.equal(saved.length, 3, "every case still ran");
  assert.equal(summary.coverage.notRun, 0);
  assert.equal(summary.coverage.errored, 3);
});

test("one vendor rate-limited while another answers is not quota exhaustion", async () => {
  const mixed: RoutedChat = async () => ({
    text: JSON.stringify({ verdict: "pass", rationale: "because." }),
    model: "stub", usage: {}, raw: {},
    servedBy: { connection: "mistral", model: "b" },
    attempts: [
      { connection: "groq", model: "a", ok: false, error: "Rate limit reached", ms: 2 },
      { connection: "mistral", model: "b", ok: true, ms: 5 },
    ],
  });
  const { store, saved } = memoryStore();
  const summary = await executeRun({
    runId: "r3", suite, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(mixed), store, concurrency: 1,
  });
  assert.equal(saved.length, 3, "the fallback worked, so nothing was exhausted");
  assert.equal(summary.coverage.notRun, 0);
});

/* --------------------------------------------------------- deterministic checks
   A rule that is true or false about the transcript does not need a model. */

test("a failing rule settles the case and the judges are never called", async () => {
  const calls: string[] = [];
  const { store, saved } = memoryStore();
  const checked: Suite = {
    ...suite,
    cases: [{ ...suite.cases[0], checks: [{ type: "must_not_contain", value: "reply to in1" }] }],
  };

  await executeRun({
    runId: "r4", suite: checked, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "pass" }, calls)), store, concurrency: 1,
  });

  assert.equal(saved[0].status, "fail");
  assert.equal(saved[0].settledBy, "deterministic");
  assert.deepEqual(calls, [], "no model was asked");
  // Nothing to attribute or corroborate: saying "graded by X" would be untrue.
  assert.equal(saved[0].judgeModel, null);
  assert.equal(saved[0].judgeAgreement, null);
  assert.deepEqual(saved[0].judgeVotes, []);
  assert.match(saved[0].rationale ?? "", /must not/);
});

test("a rule that holds does not grant a pass — the models still decide", async () => {
  // The whole discipline: "did not say the forbidden thing" is not "met the
  // expectation", so a check can fail a case and never pass one.
  const calls: string[] = [];
  const { store, saved } = memoryStore();
  const checked: Suite = {
    ...suite,
    cases: [{ ...suite.cases[0], checks: [{ type: "must_not_contain", value: "never appears" }] }],
  };

  await executeRun({
    runId: "r5", suite: checked, agent: agentReturning({}), policy: "p",
    judge: judgeArgs(judgeReturning({ C1: "fail" }, calls)), store, concurrency: 1,
  });

  assert.equal(saved[0].status, "fail", "the models decided, not the rule");
  assert.equal(saved[0].settledBy, "models");
  assert.ok(calls.length > 0);
});

test("a case the agent never answered is not put through the rules", async () => {
  // There is no transcript to be true or false about, and "must_contain" would fail
  // every rule on a dead endpoint, reporting an outage as a policy breach.
  const { store, saved } = memoryStore();
  const dead: AgentAdapter = {
    probe: async () => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 1, error: "HTTP 502" }),
    acceptsContext: () => true,
    send: async () => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 1, error: "HTTP 502" }),
  };
  const checked: Suite = {
    ...suite,
    cases: [{ ...suite.cases[0], checks: [{ type: "must_contain", value: "anything" }] }],
  };

  await executeRun({
    runId: "r6", suite: checked, agent: dead, policy: "p",
    judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });

  assert.equal(saved[0].status, "error");
  assert.equal(saved[0].settledBy, null);
});

test("a slice that loses its lease sends nothing more, writes nothing, and hands back unfinished (0047)", async () => {
  const sent: string[] = [];
  const events: string[] = [];
  let holds = true;
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "probe", toolActivity: null, latencyMs: 1 }),
    send: async ({ input }) => {
      sent.push(input);
      holds = false; // another slice takes the run over while this scenario is in flight
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1 };
    },
    acceptsContext: () => true,
  };
  const store: RunStore = {
    async saveCase() { return holds ? "saved" : "not_holder"; },
    async markRunning() { events.push("running"); },
    async finishRun(_id, outcome) { events.push(`finished:${outcome.status}`); return true; },
    async holdsRun() { return holds; },
  };

  const summary = await executeRun({
    runId: "r1", suite, agent, policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });

  assert.deepEqual(sent, ["in1"], "no scenario after the lease was lost");
  assert.equal(summary.status, "incomplete");
  assert.equal(summary.cases.length, 0, "the unsaved scenario is not counted as this slice's evidence");
  assert.match(summary.error ?? "", /Another slice took this run over/);
  assert.ok(!events.some((e) => e.startsWith("finished")), "it neither finishes nor aborts the run");
});

test("a scenario the run already holds is 'already recorded', not a failure that aborts the run (0047)", async () => {
  const events: string[] = [];
  const store: RunStore = {
    async saveCase(record) { return record.caseId === "C2" ? "already_recorded" : "saved"; },
    async markRunning() { events.push("running"); },
    async finishRun(_id, outcome) { events.push(`finished:${outcome.status}`); return true; },
  };

  const summary = await executeRun({
    runId: "r1", suite, agent: agentReturning({}), policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });

  assert.equal(summary.status, "completed");
  assert.deepEqual(events.filter((e) => e.startsWith("finished")), ["finished:completed"]);
  assert.deepEqual(summary.cases.map((c) => c.caseId), ["C1", "C3"], "the stored row, not this copy, is C2's record");
});

test("a finish that writes nothing is not reported as finished (0047)", async () => {
  let stopped = false;
  const store: RunStore = {
    async saveCase() { return "saved"; },
    async markRunning() {},
    async finishRun() { return false; },
    async isStopped() { return stopped; },
  };
  const lost = await executeRun({ runId: "r1", suite, agent: agentReturning({}), policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1 });
  assert.equal(lost.status, "incomplete", "another slice holds the run");

  const stopping: RunStore = { ...store, async isStopped() { return stopped; } };
  const run = executeRun({ runId: "r1", suite, agent: agentReturning({}), policy: "p", judge: judgeArgs(judgeReturning({})), store: { ...stopping, async finishRun() { stopped = true; return false; } }, concurrency: 1 });
  assert.equal((await run).status, "aborted", "a person stopped it between the last scenario and the finish");
});

test("an agent adapter that throws costs that scenario, not the run (C5)", async () => {
  const { store, saved, events } = memoryStore();
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "probe", toolActivity: null, latencyMs: 1 }),
    send: async ({ input }) => {
      if (input === "in2") throw new Error("The operation was aborted due to timeout");
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1 };
    },
    acceptsContext: () => true,
  };
  const summary = await executeRun({ runId: "r1", suite, agent, policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1 });
  assert.equal(summary.status, "completed");
  assert.equal(saved.length, 3, "every scenario is recorded");
  const c2 = saved.find((c) => c.caseId === "C2")!;
  assert.equal(c2.status, "error");
  assert.match(c2.error ?? "", /aborted due to timeout/);
  assert.deepEqual(events, ["running", "finished:completed"]);
});

// --- transport failures and pacing -------------------------------------------------

import { TRANSPORT_HALT_MESSAGE, isTransportFailure } from "../src/lib/runner/execute.ts";

const many: Suite = {
  key: "many", version: 1, name: "many",
  cases: Array.from({ length: 8 }, (_, i) => ({
    id: `M${i + 1}`, category: "policy", obligation: "policy_accuracy", severity: "medium" as const,
    input: `m${i + 1}`, expected_behavior: "e", assertions: ["a"],
  })),
};

const TRANSPORT = { ok: false, responseText: null, statusCode: 503, error: "Agent returned HTTP 503" } as const;

function scripted(script: Record<string, Partial<AgentResult>>, sent: string[] = [], times: number[] = []): AgentAdapter {
  return {
    probe: async () => ({ ok: true, responseText: "p", toolActivity: null, latencyMs: 1 }),
    send: async ({ input }) => {
      sent.push(input);
      times.push(Date.now());
      return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: 1, ...script[input] };
    },
    acceptsContext: () => true,
  };
}

for (const [label, failure] of [
  ["HTTP 429", { ok: false, responseText: null, statusCode: 429, error: "Agent returned HTTP 429" }],
  ["HTTP 503", TRANSPORT],
  ["connection refused", { ok: false, responseText: null, error: "Request failed: connect ECONNREFUSED" }],
] as const) {
  test(`${label} from the agent is an error, never a fail or a pass, and no judge is called`, async () => {
    const { store, saved } = memoryStore();
    const calls: string[] = [];
    await executeRun({
      runId: "r1", suite, agent: agentReturning({ in2: failure }), policy: "p",
      judge: judgeArgs(judgeReturning({}, calls)), store, concurrency: 1,
    });
    const c2 = saved.find((r) => r.caseId === "C2")!;
    assert.equal(c2.status, "error");
    assert.equal(c2.rationale, null);
    assert.equal(c2.judgeModel, null);
    assert.deepEqual(c2.judgeVotes, []);
    assert.ok(!calls.includes("C2"), "nothing to grade, so the judge was not asked");
    assert.equal(isTransportFailure(failure), true);
  });
}

test("three transport failures in a row abort the run, send nothing more, and keep what was sent", async () => {
  const { store, saved, events } = memoryStore();
  const sent: string[] = [];
  const finished: Array<{ status: string; error?: string }> = [];
  store.finishRun = async (_id, o) => { events.push(`finished:${o.status}`); finished.push(o); };
  const summary = await executeRun({
    runId: "r1", suite: many,
    agent: scripted({ m2: TRANSPORT, m3: TRANSPORT, m4: { ...TRANSPORT, statusCode: 429 } }, sent),
    policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });
  assert.equal(summary.status, "aborted");
  assert.equal(summary.error, TRANSPORT_HALT_MESSAGE);
  assert.deepEqual(sent, ["m1", "m2", "m3", "m4"], "later scenarios were never sent");
  assert.equal(saved.length, 4, "the ones already sent are saved");
  assert.deepEqual(saved.slice(1).map((r) => r.status), ["error", "error", "error"]);
  assert.deepEqual(finished, [{ status: "aborted", error: TRANSPORT_HALT_MESSAGE }]);
});

test("with several workers, a success sent before the endpoint began refusing does not reset the halt (chaos audit 2026-10-17)", async () => {
  // A WAF that answers the first three scenarios and refuses everything after. The three
  // successes are slow (graded); the refusals are instant. Counted in completion order, each
  // late success reset the streak, and six refusals went out before the run stopped.
  const { store } = memoryStore();
  const sent: string[] = [];
  const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
  const slow: Record<string, number> = { m1: 5, m2: 27, m3: 42 };
  const agent: AgentAdapter = {
    probe: async () => ({ ok: true, responseText: "p", toolActivity: null, latencyMs: 1 }),
    send: async ({ input }) => {
      sent.push(input);
      if (slow[input] !== undefined) {
        await delay(slow[input]);
        return { ok: true, responseText: `reply to ${input}`, toolActivity: null, latencyMs: slow[input] };
      }
      await delay(15);
      return { ok: false, responseText: null, toolActivity: null, statusCode: 429, latencyMs: 15, error: "Agent returned HTTP 429" };
    },
    acceptsContext: () => true,
  };
  const twelve: Suite = { ...many, cases: Array.from({ length: 12 }, (_, i) => ({ ...many.cases[0], id: `M${i + 1}`, input: `m${i + 1}` })) };
  const summary = await executeRun({ runId: "r1", suite: twelve, agent, policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 3 });
  assert.equal(summary.status, "aborted");
  assert.equal(summary.error, TRANSPORT_HALT_MESSAGE);
  const refused = sent.filter((s) => slow[s] === undefined);
  // Three in a row stop it; at most the other workers' scenarios already in flight may follow.
  assert.ok(refused.length <= 3 + 2, `${refused.length} refusals were sent before the run stopped: ${sent.join(",")}`);
});

test("error, pass, error, error does not halt the run", async () => {
  const { store, saved } = memoryStore();
  const sent: string[] = [];
  const summary = await executeRun({
    runId: "r1", suite: many,
    agent: scripted({ m1: TRANSPORT, m3: TRANSPORT, m4: TRANSPORT }, sent),
    policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });
  assert.equal(summary.status, "completed");
  assert.equal(sent.length, 8);
  assert.equal(saved.length, 8);
});

test("an ordinary agent error (invalid JSON, wrong path) does not count toward the halt", async () => {
  const { store } = memoryStore();
  const sent: string[] = [];
  const bad = { ok: false, responseText: null, statusCode: 200, error: "Agent response was not valid JSON" } as const;
  const summary = await executeRun({
    runId: "r1", suite: many,
    agent: scripted({ m1: TRANSPORT, m2: TRANSPORT, m3: bad, m4: TRANSPORT, m5: TRANSPORT }, sent),
    policy: "p", judge: judgeArgs(judgeReturning({})), store, concurrency: 1,
  });
  assert.equal(summary.status, "completed");
  assert.equal(sent.length, 8);
  assert.equal(isTransportFailure(bad), false);
  assert.equal(isTransportFailure({ ok: false, error: "Not sent: private address" }), false);
  assert.equal(isTransportFailure({ ok: false, cutByNovera: true, error: "cut" }), false);
});

test("pacing keeps successive sends at least paceMs apart; paceMs 0 adds no wait", async () => {
  const times: number[] = [];
  const { store } = memoryStore();
  await executeRun({
    runId: "r1", suite, agent: scripted({}, [], times), policy: "p",
    judge: judgeArgs(judgeReturning({})), store, concurrency: 3, paceMs: 60,
  });
  assert.equal(times.length, 3);
  for (let i = 1; i < times.length; i++) assert.ok(times[i] - times[i - 1] >= 55, `gap ${times[i] - times[i - 1]}ms`);

  const fast: number[] = [];
  const t0 = Date.now();
  await executeRun({
    runId: "r1", suite, agent: scripted({}, [], fast), policy: "p",
    judge: judgeArgs(judgeReturning({})), store: memoryStore().store, concurrency: 1,
  });
  assert.ok(Date.now() - t0 < 50, "no pacing by default");
});

test("pacing never carries a send past the deadline", async () => {
  const sent: string[] = [];
  const summary = await executeRun({
    runId: "r1", suite, agent: scripted({}, sent), policy: "p",
    judge: judgeArgs(judgeReturning({})), store: memoryStore().store, concurrency: 1,
    paceMs: 500, deadline: Date.now() + 100,
  });
  assert.equal(sent.length, 1, "the first send is immediate; the next would cross the deadline");
  assert.equal(summary.status, "incomplete");
});
