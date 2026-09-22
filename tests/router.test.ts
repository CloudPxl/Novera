import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoutedChat, RouteExhaustedError } from "../src/lib/router/execute.ts";
import { taskForSeverity, type RouteTable } from "../src/lib/router/routes.ts";
import type { Connection } from "../src/lib/providers/registry.ts";
import type { Provider } from "../src/lib/providers/types.ts";

function connection(name: string, behaviour: (model: string) => Promise<string>): Connection {
  const provider: Provider = {
    id: "openai-compatible",
    label: name,
    async chat(request) {
      const text = await behaviour(request.model);
      return { text, model: request.model, usage: {}, raw: {} };
    },
  };
  return { name, provider, apiKey: "test-key" };
}

const routes: RouteTable = {
  judge: [
    { connection: "alpha", model: "fast" },
    { connection: "beta", model: "backup" },
  ],
  judge_critical: [{ connection: "beta", model: "strong" }],
  diagnose: [{ connection: "missing", model: "nope" }],
  draft: [],
};

const request = { messages: [{ role: "user" as const, content: "grade this" }] };

test("the first working candidate answers and the rest are not tried", async () => {
  const tried: string[] = [];
  const chat = createRoutedChat({
    connections: new Map([
      ["alpha", connection("alpha", async (m) => { tried.push(m); return "from alpha"; })],
      ["beta", connection("beta", async (m) => { tried.push(m); return "from beta"; })],
    ]),
    routes,
  });

  const response = await chat("judge", request);
  assert.equal(response.text, "from alpha");
  assert.deepEqual(response.servedBy, { connection: "alpha", model: "fast" });
  assert.deepEqual(tried, ["fast"], "beta must not be called");
});

test("a rate-limited provider falls through to the next, and the failure is kept", async () => {
  const fallbacks: string[] = [];
  const chat = createRoutedChat({
    connections: new Map([
      ["alpha", connection("alpha", async () => { throw new Error("429 rate limited"); })],
      ["beta", connection("beta", async () => "from beta")],
    ]),
    routes,
    onFallback: (a) => fallbacks.push(`${a.connection}: ${a.error}`),
  });

  const response = await chat("judge", request);
  assert.equal(response.text, "from beta");
  assert.deepEqual(response.servedBy, { connection: "beta", model: "backup" });
  assert.equal(response.attempts.length, 2);
  assert.equal(response.attempts[0].ok, false);
  assert.match(response.attempts[0].error ?? "", /rate limited/);
  assert.equal(response.attempts[1].ok, true);
  assert.match(fallbacks[0], /429/);
});

test("a route naming a connection with no key reports the gap instead of hiding it", async () => {
  const chat = createRoutedChat({ connections: new Map(), routes });

  await assert.rejects(
    () => chat("diagnose", request),
    (error: unknown) => {
      assert.ok(error instanceof RouteExhaustedError);
      assert.match(error.message, /no credential configured/);
      assert.equal(error.attempts.length, 1);
      return true;
    },
  );
});

test("when every candidate fails, the error carries all of the attempts", async () => {
  const chat = createRoutedChat({
    connections: new Map([
      ["alpha", connection("alpha", async () => { throw new Error("429"); })],
      ["beta", connection("beta", async () => { throw new Error("503"); })],
    ]),
    routes,
  });

  await assert.rejects(
    () => chat("judge", request),
    (error: unknown) => {
      assert.ok(error instanceof RouteExhaustedError);
      assert.equal(error.attempts.length, 2);
      assert.match(error.message, /429/);
      assert.match(error.message, /503/);
      return true;
    },
  );
});

test("an empty route is exhausted immediately rather than hanging", async () => {
  const chat = createRoutedChat({ connections: new Map(), routes });
  await assert.rejects(() => chat("draft", request), /no candidate was configured/);
});

test("high and critical severities take the stronger route", () => {
  assert.equal(taskForSeverity("critical"), "judge_critical");
  assert.equal(taskForSeverity("High"), "judge_critical");
  assert.equal(taskForSeverity("medium"), "judge");
  assert.equal(taskForSeverity("low"), "judge");
});

test("excluding a connection skips every model it serves", async () => {
  const tried: string[] = [];
  const chat = createRoutedChat({
    connections: new Map([
      ["alpha", connection("alpha", async (m) => { tried.push(`alpha/${m}`); return "from alpha"; })],
      ["beta", connection("beta", async (m) => { tried.push(`beta/${m}`); return "from beta"; })],
    ]),
    routes: {
      ...routes,
      // Two alpha models in front, which is what the real judge route looked like
      // before mistral existed: a "second opinion" could be alpha again.
      judge: [
        { connection: "alpha", model: "fast" },
        { connection: "alpha", model: "small" },
        { connection: "beta", model: "backup" },
      ],
    },
  });

  const response = await chat("judge", request, { excludeConnections: ["alpha"] });
  assert.equal(response.servedBy.connection, "beta");
  assert.deepEqual(tried, ["beta/backup"], "neither alpha model was called");
});

test("a route with nothing left after exclusion is exhausted, not silently served", async () => {
  const chat = createRoutedChat({
    connections: new Map([["alpha", connection("alpha", async () => "from alpha")]]),
    routes: { ...routes, judge: [{ connection: "alpha", model: "fast" }] },
  });

  await assert.rejects(
    () => chat("judge", request, { excludeConnections: ["alpha"] }),
    RouteExhaustedError,
  );
});
