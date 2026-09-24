import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoutedChat, RouteExhaustedError } from "../src/lib/router/execute.ts";
import { DEFAULT_ROUTES, routesForConnection } from "../src/lib/router/routes.ts";
import type { Connection } from "../src/lib/providers/registry.ts";

/**
 * What a customer's own key can actually grade.
 *
 * `DEFAULT_ROUTES` names *our* connections — the ones we hold keys for. A workspace
 * that brings its own key holds exactly one connection, and the router resolves a
 * candidate by connection name. So a route table naming connections the workspace does
 * not have produces "no credential configured" on every candidate, the route exhausts,
 * and every case in the run comes back errored — after the customer has left the trial
 * on the strength of a settings page promising the opposite.
 */

function fakeConnection(name: string): Connection {
  return {
    name,
    apiKey: "test",
    provider: {
      id: "openai-compatible",
      label: name,
      async chat(request) {
        return { text: "ok", model: request.model, usage: {}, raw: {} };
      },
    },
  };
}

const ask = (connections: Map<string, Connection>, routes: typeof DEFAULT_ROUTES) =>
  createRoutedChat({ connections, routes })("judge", { messages: [{ role: "user", content: "hi" }] });

test("the shipped route table cannot grade on a key from a vendor it does not name", async () => {
  // Three of the four providers the settings form offers. None of them appears in
  // DEFAULT_ROUTES.judge, which is groq and mistral.
  for (const provider of ["google", "anthropic", "openrouter"]) {
    const connections = new Map([[provider, fakeConnection(provider)]]);
    await assert.rejects(
      () => ask(connections, DEFAULT_ROUTES),
      (error: unknown) => {
        assert.ok(error instanceof RouteExhaustedError);
        assert.ok(
          error.attempts.every((a) => a.error === "no credential configured for this connection"),
          "the failure is a configuration gap, not a provider refusing",
        );
        return true;
      },
      `a ${provider} key reached a judge it could not possibly use`,
    );
  }
});

test("a route built from the workspace's own connection grades on it", async () => {
  const connections = new Map([["anthropic", fakeConnection("anthropic")]]);
  const routes = routesForConnection("anthropic", ["claude-opus-5"]);

  const response = await ask(connections, routes);
  assert.equal(response.servedBy.connection, "anthropic");
  assert.equal(response.servedBy.model, "claude-opus-5");
});

test("every task a run needs is routable, not only the two grading ones", async () => {
  // A run also diagnoses and drafts. A table with `judge` alone would grade the suite
  // and then fail on the first diagnosis, which is a worse failure than none at all:
  // it happens after the evidence exists and looks like the evidence is at fault.
  const routes = routesForConnection("groq", ["openai/gpt-oss-120b"]);
  for (const task of Object.keys(DEFAULT_ROUTES) as Array<keyof typeof DEFAULT_ROUTES>) {
    assert.ok(routes[task]?.length, `no candidate for "${task}"`);
    assert.ok(
      routes[task].every((c) => c.connection === "groq"),
      `"${task}" routes somewhere the workspace holds no key`,
    );
  }
});

test("a second model is a second opinion; one model is one vote", async () => {
  // Consensus asks for corroboration. With one model it can only ever come back
  // uncorroborated, and the settings page has to say so rather than imply two.
  assert.equal(routesForConnection("groq", ["a"]).judge.length, 1);
  assert.deepEqual(
    routesForConnection("groq", ["a", "b"]).judge.map((c) => c.model),
    ["a", "b"],
  );
});

test("a blank or duplicated model never becomes a candidate", async () => {
  assert.deepEqual(routesForConnection("groq", ["a", "  ", "a", ""]).judge.map((c) => c.model), ["a"]);
  assert.throws(() => routesForConnection("groq", []), /at least one model/);
});
