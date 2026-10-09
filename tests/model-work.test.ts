import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolveConnections } from "../src/lib/providers/workspace-connections.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { observedChat, type CallRecord } from "../src/lib/providers/model-work.ts";
import type { Provider, ChatRequest } from "../src/lib/providers/types.ts";
import type { Connection } from "../src/lib/providers/registry.ts";
import { factualFallback, parseReply, unsupportedClaims, type AssistantSnapshot } from "../src/lib/assistant/core.ts";

function mockProvider(calls: string[], name: string, text = '{"ok":true}'): Provider {
  return {
    id: "openai-compatible",
    label: name,
    async chat(request: ChatRequest) {
      calls.push(name);
      void request;
      return { text, model: `${name}-model`, usage: {}, raw: null };
    },
  };
}

test("a workspace key yields only that key's connection; Novera's connections are never consulted", () => {
  let oursAsked = 0;
  const resolved = resolveConnections({ value: "sk-ant-customer", provider: "anthropic", models: ["claude-x"] }, () => { oursAsked++; return new Map(); });
  assert.equal(oursAsked, 0, "Novera's connections are not even read");
  assert.equal(resolved.source, "workspace_key");
  assert.deepEqual([...resolved.connections.keys()], ["anthropic"]);
  assert.equal(resolved.connections.get("anthropic")?.owner, "customer");
  for (const task of ["judge", "judge_critical", "diagnose", "draft"] as const) {
    assert.ok(resolved.routes[task].every((c) => c.connection === "anthropic"), `${task} routes only on the workspace key`);
  }
});

test("diagnosis, drafting and extraction on a workspace key call only the workspace's provider (mocked), never ours", async () => {
  const calls: string[] = [];
  const resolved = resolveConnections({ value: "gsk_customer", provider: "groq", models: ["customer-model"] }, () => {
    throw new Error("Novera's connections must not be read for a workspace with its own key");
  });
  const customer = resolved.connections.get("groq")!;
  const connections = new Map<string, Connection>([["groq", { ...customer, provider: mockProvider(calls, "customer") }]]);
  const ours: Connection = { name: "mistral", provider: mockProvider(calls, "novera"), apiKey: "ours" };
  // Even if our connection were present in the map, the workspace route never names it.
  connections.set("mistral", ours);
  const records: CallRecord[] = [];
  const chat = observedChat(createRoutedChat({ connections, routes: resolved.routes }), records);
  for (const task of ["diagnose", "draft"] as const) {
    await chat(task, { messages: [{ role: "user", content: "x" }], maxTokens: 10 }, { data: "redacted_customer" });
  }
  assert.deepEqual(calls, ["customer", "customer"]);
  assert.equal(records.length, 2);
  assert.ok(records.every((r) => r.served_by === "groq/customer-model" && !r.fell_back), JSON.stringify(records));
});

test("a stored key that cannot be routed fails; it never falls back to Novera's keys", () => {
  let oursAsked = 0;
  assert.throws(() => resolveConnections({ value: "k", provider: "unknown-vendor", models: ["m"] }, () => { oursAsked++; return new Map(); }));
  assert.equal(oursAsked, 0);
});

test("only a workspace with no key at all is served on the trial allowance", () => {
  const ours = new Map<string, Connection>([["groq", { name: "groq", provider: mockProvider([], "novera"), apiKey: "ours" }]]);
  const resolved = resolveConnections(null, () => ours);
  assert.equal(resolved.source, "trial_free");
  assert.equal(resolved.connections, ours);
});

test("no workspace model work reaches for Novera's keys directly", () => {
  for (const file of ["../src/lib/workflow/propose.ts", "../src/lib/workflow/builder.ts", "../src/lib/assistant/actions.ts"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /connectionsFromEnv/, `${file} resolves through workspaceChat`);
    assert.match(source, /workspaceChat\(/, file);
  }
});

const snapshot: AssistantSnapshot = {
  workspace: "Acme",
  funding: "trial allowance: 2 of 3 runs left",
  canRun: true,
  blockedReason: null,
  agents: [{ id: "a1", name: "Bot", host: "bot.example", policyVersion: 1, lastProbe: "ok" }],
  runs: [{ id: "r1", agent: "Bot", status: "completed", date: "2026-10-08 10:00", passed: 7, failed: 3, noResult: 0 }],
  reports: 1,
};

test("Ask Novera: a figure nothing supports, or a claim that a key works, makes the reply unusable", () => {
  const given = { snapshot, docs: [{ slug: "how-a-run-works", title: "How", body: "A run has 49 scenarios." }], question: "How many runs do I have left?" };
  assert.deepEqual(unsupportedClaims("You have 2 of 3 runs left; your last run passed 7.", given), []);
  assert.deepEqual(unsupportedClaims("A run has 49 scenarios.", given), []);
  assert.deepEqual(unsupportedClaims("You have 1 trial run remaining.", given), ["a run balance of 1"]);
  assert.deepEqual(unsupportedClaims("About 80% of agents pass.", given), ["the figure 80"]);
  assert.deepEqual(unsupportedClaims("Your key is valid but only works for trial runs.", given), ["a claim that a key or connection works"]);
});

test("Ask Novera: markdown links become plain text, and a link to a doc becomes a citation", () => {
  const docs = [{ slug: "the-trial-and-your-own-key", title: "Trial", body: "" }];
  const parsed = parseReply({ reply: "See [the trial and your own key](docs/the-trial-and-your-own-key) and [this](https://evil.example).", citations: [] }, snapshot, docs);
  assert.equal(parsed?.reply, "See the trial and your own key and this.");
  assert.deepEqual(parsed?.citations, ["the-trial-and-your-own-key"]);
});

test("Ask Novera: the fallback states only computed facts", () => {
  const text = factualFallback(snapshot);
  assert.match(text, /trial allowance: 2 of 3 runs left/);
  assert.match(text, /7 passed, 3 failed, 0 with no result/);
  assert.deepEqual(unsupportedClaims(text, { snapshot, docs: [], question: "" }), [], "the fallback itself passes the guard");
});
