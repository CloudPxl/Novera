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
  // Customer-owned, so these fallback tests are not also privacy tests: our own
  // connections are held to data ceilings, tested in tests/privacy.test.ts.
  return { name, provider, apiKey: "test-key", owner: "customer" };
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

// --- pacing Novera's own free keys (2026-11-08) --------------------------------------------------

import { Pacer, PACE_MS, PACE_WAIT_MAX_MS, paceIntervals } from "../src/lib/router/execute.ts";

function ours(name: string, behaviour: (model: string) => Promise<string>): Connection {
  return { ...connection(name, behaviour), owner: "novera", ceiling: "identifiable_customer" };
}

test("the pacer hands out one slot per interval per model, and refuses a slot further than the caller can wait", () => {
  const pacer = new Pacer({ slow: 1_000 });
  const a = { connection: "slow", model: "a" };
  assert.equal(pacer.reserve(a, 5_000, 0), 0);
  assert.equal(pacer.reserve(a, 5_000, 0), 1_000);
  assert.equal(pacer.reserve(a, 5_000, 400), 1_600);
  assert.equal(pacer.reserve(a, 1_000, 400), null, "the next slot is 2.6 s away");
  assert.equal(pacer.reserve(a, 5_000, 400), 2_600, "a refused reservation took no slot");
  assert.equal(pacer.reserve({ connection: "slow", model: "b" }, 0, 400), 0, "another model on the connection has its own queue");
  assert.equal(pacer.reserve({ connection: "fast", model: "x" }, 0, 0), 0, "an unlisted connection is never paced");
  assert.equal(pacer.reserve({ connection: "fast", model: "x" }, 0, 0), 0);
  assert.equal(PACE_MS.mistral >= 30_000, true, "Mistral's free tier is two requests a minute per model");
  assert.equal(PACE_MS.groq >= 7_000, true, "Groq's free tier is 8,000 tokens a minute, a grading call about 900");
  assert.equal(PACE_MS.gemini, undefined, "the paid key is not paced");
  assert.ok(PACE_WAIT_MAX_MS <= 20_000);
  assert.deepEqual(paceIntervals({ NOVERA_PACE_MS: "groq=1000, mistral=0,bad,=5" }), { groq: 1_000, mistral: 0 });
  assert.deepEqual(paceIntervals({}), { ...PACE_MS });
});

test("calls on one of our paced connections start at least the interval apart", async () => {
  const starts: number[] = [];
  const chat = createRoutedChat({
    connections: new Map([["alpha", ours("alpha", async () => { starts.push(Date.now()); return "ok"; })]]),
    routes: { ...routes, judge: [{ connection: "alpha", model: "fast" }] },
    pacer: new Pacer({ alpha: 120 }),
  });
  await Promise.all([chat("judge", request), chat("judge", request), chat("judge", request)]);
  starts.sort((a, b) => a - b);
  assert.ok(starts[1] - starts[0] >= 110 && starts[2] - starts[1] >= 110, `starts ${starts.map((s) => s - starts[0]).join(", ")}`);
});

test("a slot too far away for the deadline is not sent: it is recorded as paced and the next candidate answers", async () => {
  let alphaCalls = 0;
  const chat = createRoutedChat({
    connections: new Map([
      ["alpha", ours("alpha", async () => { alphaCalls++; return "from alpha"; })],
      ["beta", ours("beta", async () => "from beta")],
    ]),
    routes,
    pacer: new Pacer({ alpha: 60_000 }),
  });
  assert.equal((await chat("judge", request)).text, "from alpha");
  const second = await chat("judge", request, { deadline: Date.now() + 10_000 });
  assert.equal(second.text, "from beta");
  assert.equal(alphaCalls, 1);
  const paced = second.attempts.find((a) => a.connection === "alpha")!;
  assert.equal(paced.reason, "paced");
  assert.equal(paced.ok, false);
  assert.match(paced.error ?? "", /rate-limited/);
});

test("a customer's own key is never paced", async () => {
  const starts: number[] = [];
  const chat = createRoutedChat({
    connections: new Map([["alpha", connection("alpha", async () => { starts.push(Date.now()); return "ok"; })]]),
    routes: { ...routes, judge: [{ connection: "alpha", model: "fast" }] },
    pacer: new Pacer({ alpha: 60_000 }),
  });
  await chat("judge", request);
  await chat("judge", request);
  assert.equal(starts.length, 2);
  assert.ok(starts[1] - starts[0] < 1_000);
});
