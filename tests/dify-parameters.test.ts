import { test } from "node:test";
import assert from "node:assert/strict";
import { difyParametersUrl, discoverDifyInputs, missingInputs, parseUserInputForm } from "../src/lib/agents/dify-parameters.ts";
import { mockGuardedFetch } from "./guarded-fetch.ts";
import { setResolverForTests } from "../src/lib/net/public-url.ts";

setResolverForTests(async () => ["93.184.216.34"]);

const FORM = {
  user_input_form: [
    { "text-input": { label: "Customer tier", variable: "customer_tier", required: true, default: "standard", max_length: 48 } },
    { "text-input": { label: "Order", variable: "order_id", required: true, default: "" } },
    { select: { label: "Country", variable: "account_country", required: false, options: ["RO", "DE"] } },
    { number: { label: "Total", variable: "order_total_eur", required: false, default: 40 } },
    { "text-input": { label: "bad", variable: "has space", required: true } },
    { nonsense: "x" },
  ],
};

test("a Dify endpoint's parameters live beside it on the same host; anything else has none", () => {
  assert.equal(difyParametersUrl("https://api.dify.ai/v1/chat-messages"), "https://api.dify.ai/v1/parameters");
  assert.equal(difyParametersUrl("https://dify.example/v1/workflows/run/"), "https://dify.example/v1/parameters");
  assert.equal(difyParametersUrl("https://dify.example/v1/completion-messages?x=1"), "https://dify.example/v1/parameters");
  assert.equal(difyParametersUrl("https://agent.example/chat"), null);
  assert.equal(difyParametersUrl("not a url"), null);
});

test("the Start node's variables are read in order, with type, required and default; a malformed one is skipped", () => {
  const got = parseUserInputForm(FORM);
  assert.deepEqual(got.map((v) => v.variable), ["customer_tier", "order_id", "account_country", "order_total_eur"]);
  assert.deepEqual(got[0], { variable: "customer_tier", label: "Customer tier", type: "text-input", required: true, defaultValue: "standard" });
  assert.equal(got[1].defaultValue, null, "an empty default is no default");
  assert.deepEqual(got[2].options, ["RO", "DE"]);
  assert.equal(got[3].defaultValue, "40");
  assert.deepEqual(parseUserInputForm({}), []);
  assert.deepEqual(parseUserInputForm(null), []);
});

test("a required variable the request body's inputs does not carry is missing", () => {
  const declared = parseUserInputForm(FORM);
  assert.deepEqual(missingInputs(declared, { inputs: {}, query: "{{input}}" }), ["customer_tier", "order_id"]);
  assert.deepEqual(missingInputs(declared, { inputs: { customer_tier: "gold", order_id: "" } }), ["order_id"]);
  assert.deepEqual(missingInputs(declared, { inputs: { customer_tier: "gold", order_id: "{{context}}" } }), []);
});

test("discovery asks the endpoint's own host with the same key, and is silent on any failure", async (t) => {
  const seen: Array<{ url: string; auth?: string; method?: string }> = [];
  mockGuardedFetch(t, async (url, init) => {
    const headers = (init as RequestInit).headers as Record<string, string>;
    seen.push({ url: String(url), auth: headers.authorization, method: (init as RequestInit).method });
    return new Response(JSON.stringify(FORM), { status: 200, headers: { "content-type": "application/json" } });
  });
  const config = { url: "https://api.dify.example/v1/chat-messages", authHeaderName: "authorization" };
  const found = await discoverDifyInputs(config, "Bearer app-xyz");
  assert.equal(found?.length, 4);
  assert.deepEqual(seen, [{ url: "https://api.dify.example/v1/parameters", auth: "Bearer app-xyz", method: "GET" }]);

  mockGuardedFetch(t, async () => new Response("nope", { status: 404 }));
  assert.equal(await discoverDifyInputs(config, "Bearer app-xyz"), null);
  mockGuardedFetch(t, async () => new Response("not json", { status: 200 }));
  assert.equal(await discoverDifyInputs(config, "Bearer app-xyz"), null);
  mockGuardedFetch(t, async () => { throw new Error("reset"); });
  assert.equal(await discoverDifyInputs(config), null);
  assert.equal(await discoverDifyInputs({ url: "https://agent.example/chat" }), null, "not Dify: nothing is asked");
});
