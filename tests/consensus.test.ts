import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeCase } from "../src/lib/judge/consensus.ts";
import type { RoutedChat } from "../src/lib/router/execute.ts";
import type { Candidate } from "../src/lib/router/routes.ts";

const PANEL: Candidate[] = [
  { connection: "groq", model: "a" },
  { connection: "google", model: "b" },
  { connection: "openrouter", model: "c" },
];

/** A router whose models return scripted verdicts, respecting `exclude`. */
function panel(script: Record<string, "pass" | "fail" | "garbage" | "down">): RoutedChat {
  return async (_task, _request, options) => {
    const next = PANEL.find(
      (c) => !options?.exclude?.some((e) => e.connection === c.connection && e.model === c.model),
    );
    if (!next) {
      const error = new Error("every candidate failed") as Error & { attempts: unknown[] };
      error.attempts = [];
      throw error;
    }
    const verdict = script[next.model];
    if (verdict === "down") {
      const error = new Error("rate limited") as Error & { attempts: unknown[] };
      error.attempts = [];
      throw error;
    }
    return {
      text: verdict === "garbage" ? "hmm, hard to say" : JSON.stringify({ verdict, rationale: `${next.model} says so`, failed_assertions: [] }),
      model: next.model,
      usage: {},
      raw: null,
      servedBy: next,
      attempts: [],
    };
  };
}

const CASE = {
  testCase: { caseId: "T01", input: "i", expectedBehavior: "e", assertions: ["a"] },
  agentResponse: "the reply",
  severity: "medium",
};

test("two models agreeing produces an agreed verdict and stops there", async () => {
  const outcome = await gradeCase({ chat: panel({ a: "fail", b: "fail", c: "pass" }), ...CASE });
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.agreement, "agreed");
  assert.equal(outcome.votes.length, 2, "a third model is not consulted when two agree");
});

test("a disagreement is settled by a third model, and the majority wins", async () => {
  const outcome = await gradeCase({ chat: panel({ a: "pass", b: "fail", c: "fail" }), ...CASE });
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.agreement, "majority");
  assert.equal(outcome.votes.length, 3);
});

test("an unsettleable disagreement is an error, never a coin toss", async () => {
  const outcome = await gradeCase({ chat: panel({ a: "pass", b: "fail", c: "garbage" }), ...CASE });
  // Two models contradicted each other and nothing broke the tie. Picking either
  // one would put a fabricated verdict in a customer's report.
  assert.equal(outcome.status, "error");
  assert.equal(outcome.agreement, "unresolved");
  assert.match(outcome.error ?? "", /disagreed/);
});

test("a single reachable model still grades, but is marked uncorroborated", async () => {
  const outcome = await gradeCase({ chat: panel({ a: "fail", b: "down", c: "down" }), ...CASE });
  assert.equal(outcome.status, "fail");
  assert.equal(outcome.agreement, "unconfirmed");
});

test("every vote is recorded, including the model that was overruled", async () => {
  const outcome = await gradeCase({ chat: panel({ a: "pass", b: "fail", c: "fail" }), ...CASE });
  assert.deepEqual(
    outcome.votes.map((v) => `${v.model}:${v.status}`),
    ["groq/a:pass", "google/b:fail", "openrouter/c:fail"],
  );
});

test("a second opinion is never asked of the model that gave the first", async () => {
  const consulted: string[] = [];
  const chat: RoutedChat = async (_task, _request, options) => {
    const next = PANEL.find(
      (c) => !options?.exclude?.some((e) => e.connection === c.connection && e.model === c.model),
    )!;
    consulted.push(next.model);
    return {
      text: JSON.stringify({ verdict: "fail", rationale: "r", failed_assertions: [] }),
      model: next.model, usage: {}, raw: null, servedBy: next, attempts: [],
    };
  };
  await gradeCase({ chat, ...CASE });
  assert.deepEqual(consulted, ["a", "b"]);
});
