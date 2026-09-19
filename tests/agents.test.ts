import { test } from "node:test";
import assert from "node:assert/strict";
import { fillTemplate, readPath } from "../src/lib/agents/template.ts";
import { httpAgent } from "../src/lib/agents/http.ts";
import type { HttpAgentConfig } from "../src/lib/agents/types.ts";

test("a policy containing quotes and newlines cannot break the request body", () => {
  const nasty = 'Refunds: say "no" unless\nthe account is verified. Path: C:\\data';
  const filled = fillTemplate(
    { messages: [{ role: "system", content: "{{policy}}" }, { role: "user", content: "{{input}}" }] },
    { policy: nasty, input: "hello" },
  );

  const roundTripped = JSON.parse(JSON.stringify(filled));
  assert.equal(roundTripped.messages[0].content, nasty);
  assert.equal(roundTripped.messages[1].content, "hello");
});

test("placeholders substitute inside longer strings and leave unknown ones alone", () => {
  assert.equal(fillTemplate("Question: {{input}} ({{missing}})", { input: "why" }), "Question: why ({{missing}})");
});

test("non-string values in the template are preserved", () => {
  const filled = fillTemplate({ stream: false, n: 1, tags: ["a", "{{input}}"] }, { input: "b" });
  assert.deepEqual(filled, { stream: false, n: 1, tags: ["a", "b"] });
});

test("response paths walk objects and array indexes", () => {
  const body = { choices: [{ message: { content: "hi" } }] };
  assert.equal(readPath(body, "choices.0.message.content"), "hi");
  assert.equal(readPath(body, "choices.9.message.content"), undefined);
  assert.equal(readPath(body, "nope.deeper"), undefined);
});

const config: HttpAgentConfig = {
  kind: "http",
  url: "https://agent.example/chat",
  bodyTemplate: { message: "{{input}}", system: "{{policy}}" },
  responsePath: "reply",
};

test("an unreachable agent reports an error instead of throwing", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("ECONNREFUSED");
  });

  const result = await httpAgent(config).probe();
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /ECONNREFUSED/);
  assert.equal(result.responseText, null);
});

test("a non-2xx response is an error and keeps the body as evidence", async (t) => {
  t.mock.method(globalThis, "fetch", async () => new Response("rate limited", { status: 429 }));

  const result = await httpAgent(config).send({ input: "hi", policy: "p" });
  assert.equal(result.ok, false);
  assert.equal(result.statusCode, 429);
  assert.match(result.error ?? "", /HTTP 429/);
});

test("a response missing the configured path is an error, not an empty pass", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ something_else: "surprise" }),
  );

  const result = await httpAgent(config).send({ input: "hi", policy: "p" });
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /response path "reply"/);
});

test("a good response is returned with its latency and raw body", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    Response.json({ reply: "I need to verify your identity first.", calls: [] }),
  );

  const result = await httpAgent({ ...config, toolActivityPath: "calls" }).send({ input: "hi", policy: "p" });
  assert.equal(result.ok, true);
  assert.match(result.responseText ?? "", /verify your identity/);
  assert.deepEqual(result.toolActivity, []);
  assert.ok(typeof result.latencyMs === "number");
});

test("the auth header is sent only when both a name and a value exist", async (t) => {
  let seen: Record<string, string> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    seen = init.headers as Record<string, string>;
    return Response.json({ reply: "ok" });
  });

  await httpAgent({ ...config, authHeaderName: "authorization" }, "Bearer tok").probe();
  assert.equal(seen.authorization, "Bearer tok");

  await httpAgent(config, "Bearer tok").probe();
  assert.equal(seen.authorization, undefined);
});
