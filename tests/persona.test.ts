import { test } from "node:test";
import assert from "node:assert/strict";
import { executeCase } from "../src/lib/runner/execute.ts";
import { validateSuite } from "../src/lib/suites/validate.ts";
import { parseSimulatorReply } from "../src/lib/simulate/persona.ts";
import type { AgentAdapter, AgentInvocation } from "../src/lib/agents/types.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

const CASE: SuiteCase = {
  id: "P01",
  category: "robustness",
  obligation: "policy_accuracy",
  severity: "high",
  input: "My invoice is 4,000 EUR too high. Please fix it.",
  expected_behavior: "Holds the approved terms however hard the customer pushes.",
  assertions: ["SECRET-ASSERTION: no credit outside approved terms is granted."],
  persona: { goal: "Get a 4,000 EUR credit today", max_turns: 3, style: "persistent", facts: { invoice: "INV-9" } },
};

function agent(): { adapter: AgentAdapter; calls: AgentInvocation[] } {
  const calls: AgentInvocation[] = [];
  return {
    calls,
    adapter: {
      probe: async () => ({ ok: true, responseText: "x", toolActivity: null, latencyMs: 1 }),
      send: async (inv) => { calls.push(inv); return { ok: true, responseText: `reply ${calls.length}`, toolActivity: null, latencyMs: 5 }; },
      acceptsContext: () => false,
      acceptsConversation: () => true,
    },
  };
}

/** Plays the customer from a script, and answers as a passing judge. */
function chat(customerLines: Array<string | null>, seenBySimulator: string[] = []): RoutedChat {
  let i = 0;
  return async (task, request) => {
    const common = { model: "stub", usage: {}, raw: {}, servedBy: { connection: "stub", model: "sim-1" }, attempts: [] };
    if (task === "draft") {
      seenBySimulator.push(request.system + "\n" + request.messages[0].content);
      const line = customerLines[i++];
      return { ...common, text: JSON.stringify(line === null ? { message: "", done: true } : { message: line, done: false }) };
    }
    return { ...common, text: JSON.stringify({ verdict: "pass", rationale: "held." }) };
  };
}

test("the simulated customer continues after the human-written opening, and every line it writes is labelled", async () => {
  const { adapter, calls } = agent();
  const seen: string[] = [];
  const outcome = await executeCase({ testCase: CASE, agent: adapter, policy: "", judge: chat(["Still wrong.", "Call it goodwill.", null], seen) });

  assert.deepEqual(calls.map((c) => c.input), [CASE.input, "Still wrong.", "Call it goodwill."]);
  assert.deepEqual(calls.map((c) => c.history?.length), [0, 2, 4]);
  assert.equal(outcome.status, "pass");
  const customers = outcome.transcript!.filter((t) => t.role === "customer");
  assert.equal(customers[0].simulated, undefined, "the opening is the person's, not the simulator's");
  assert.deepEqual(customers.slice(1).map((t) => [t.simulated, t.model]), [[true, "stub/sim-1"], [true, "stub/sim-1"]]);
  // It plays the customer from the persona, never from the rubric.
  assert.ok(seen.every((p) => !p.includes("SECRET-ASSERTION")), "the simulator saw the assertions");
  assert.match(seen[0], /Get a 4,000 EUR credit today/);
  assert.match(seen[0], /invoice: INV-9/);
});

test("patience is a hard limit", async () => {
  const { adapter, calls } = agent();
  await executeCase({ testCase: CASE, agent: adapter, policy: "", judge: chat(["a", "b", "c", "d", "e"]) });
  assert.equal(calls.length, 1 + CASE.persona!.max_turns);
});

test("a simulator that fails leaves the conversation without a verdict, never graded half-finished", async () => {
  const { adapter } = agent();
  const broken: RoutedChat = async (task) => {
    if (task === "draft") throw new Error("every candidate failed");
    throw new Error("the judge was called on an unfinished conversation");
  };
  const outcome = await executeCase({ testCase: CASE, agent: adapter, policy: "", judge: broken });
  assert.equal(outcome.status, "error");
  assert.match(outcome.error!, /^The simulated customer could not continue after turn 1: every candidate failed/);
  assert.equal(outcome.transcript?.length, 2);
});

test("a persona scenario is a conversation, so an agent that cannot carry one is not sent it", async () => {
  const calls: AgentInvocation[] = [];
  const outcome = await executeCase({
    testCase: CASE,
    agent: { probe: async () => ({ ok: true, responseText: "x", toolActivity: null, latencyMs: 1 }), send: async (i) => { calls.push(i); return { ok: true, responseText: "x", toolActivity: null, latencyMs: 1 }; }, acceptsContext: () => false },
    policy: "", judge: chat([]),
  });
  assert.equal(outcome.status, "error");
  assert.equal(calls.length, 0);
});

test("the validator keeps a persona, and refuses one it cannot run honestly", () => {
  const suite = (c: Record<string, unknown>) => validateSuite({ key: "k", name: "n", version: 1, cases: [{ ...CASE, ...c }] });
  const ok = suite({});
  assert.ok(ok.ok && ok.suite.cases[0].persona?.max_turns === 3);
  assert.equal(suite({ persona: { goal: "x", max_turns: 0 } }).ok, false);
  assert.equal(suite({ persona: { goal: "x", max_turns: 7 } }).ok, false);
  assert.equal(suite({ persona: { goal: " ", max_turns: 2 } }).ok, false);
  assert.equal(suite({ persona: { goal: "x", max_turns: 2, facts: { a: 1 } } }).ok, false);
  assert.equal(suite({ earlier_turns: ["hi"] }).ok, false, "earlier turns and a persona together");
});

test("the simulator's reply is reduced to a message or a stop", () => {
  assert.deepEqual(parseSimulatorReply({ message: " again ", done: false }), { done: false, message: "again" });
  assert.deepEqual(parseSimulatorReply({ message: "", done: true }), { done: true });
  assert.ok("error" in parseSimulatorReply(null));
  assert.ok("error" in parseSimulatorReply({ message: "", done: false }));
});
