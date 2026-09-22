import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { openAiCompatibleProvider } from "../src/lib/providers/openai-compatible.ts";
import { googleProvider } from "../src/lib/providers/google.ts";
import { ProviderError } from "../src/lib/providers/types.ts";

const mistral = openAiCompatibleProvider("https://api.mistral.ai/v1");
const chat = { model: "ministral-3b-latest", messages: [{ role: "user" as const, content: "grade" }] };

function respond(t: TestContext, body: unknown, status = 200) {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }));
}

test("a mistral error says what went wrong, not just the HTTP status", async (t) => {
  // Mistral does not nest under `error`; read as an OpenAI body this shape looks
  // like no error at all, and every failure arrived as bare "Too Many Requests".
  respond(t, { object: "error", message: "Rate limit exceeded", type: "rate_limited", code: "1300" }, 429);
  await assert.rejects(() => mistral.chat(chat, "k"), (e: ProviderError) => {
    assert.match(e.message, /Rate limit exceeded/);
    assert.equal(e.status, 429);
    return true;
  });
});

test("an error body served with HTTP 200 is still an error", async (t) => {
  respond(t, { object: "error", message: "Service tier capacity exceeded" }, 200);
  await assert.rejects(() => mistral.chat(chat, "k"), /capacity exceeded/);
});

test("an empty completion is a provider failure, so the router can fall back", async (t) => {
  // Returned as "", this travelled to the judge, failed to parse, and landed in a
  // customer's report as an errored case — a case the agent never actually failed.
  respond(t, { choices: [{ message: { content: "" }, finish_reason: "length" }], usage: {} }, 200);
  await assert.rejects(() => mistral.chat(chat, "k"), /empty completion.*length/);
});

test("a google answer spent entirely on hidden reasoning is a failure too", async (t) => {
  respond(t, {
    candidates: [{ content: { parts: [] }, finishReason: "STOP" }],
    usageMetadata: { thoughtsTokenCount: 332 },
  });
  await assert.rejects(
    () => googleProvider.chat({ ...chat, model: "gemini-3.5-flash" }, "k"),
    /empty completion.*thoughtTokens: 332/,
  );
});

test("grading asks google to stop thinking, and asks by the 3.x control", async (t) => {
  let sent: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
  });
  await googleProvider.chat({ ...chat, model: "gemini-3.5-flash", reasoning: "off" }, "k");
  const config = sent.generationConfig as { thinkingConfig?: { thinkingLevel?: string; thinkingBudget?: number } };
  // thinkingBudget: 0 is the 2.x control and gemini-3.5-flash-lite rejects it with a
  // 400, so sending it would break the route it was meant to repair.
  assert.equal(config.thinkingConfig?.thinkingLevel, "low");
  assert.equal(config.thinkingConfig?.thinkingBudget, undefined);
});

test("nothing is asked of a provider that was not told to skip reasoning", async (t) => {
  let sent: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    sent = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "{}" }] } }] }), { status: 200 });
  });
  await googleProvider.chat({ ...chat, model: "gemini-3.5-flash" }, "k");
  assert.equal((sent.generationConfig as Record<string, unknown>).thinkingConfig, undefined);
});

test("a provider that echoes the key back does not get to store it", async (t) => {
  // Some hosts return the offending request under error.metadata.raw. Every provider
  // failure is stored on the case row and shown to the operator, so an upstream
  // message is somewhere a key could end up durably.
  respond(t, {
    error: {
      message: "Invalid authentication",
      metadata: { raw: "authorization: Bearer sk-live-SECRETVALUE0987654321" },
    },
  }, 401);
  await assert.rejects(() => mistral.chat(chat, "sk-live-SECRETVALUE0987654321"), (e: ProviderError) => {
    assert.doesNotMatch(e.message, /SECRETVALUE/);
    assert.match(e.message, /Invalid authentication/, "the diagnosable part survives");
    return true;
  });
});

test("a key belonging to someone else is redacted too", async (t) => {
  respond(t, { error: { message: "quota exhausted for gsk_ABCDEFGH12345678 on this org" } }, 429);
  await assert.rejects(() => mistral.chat(chat, "unrelated-key-value"), (e: ProviderError) => {
    assert.doesNotMatch(e.message, /gsk_ABCDEFGH/);
    return true;
  });
});
