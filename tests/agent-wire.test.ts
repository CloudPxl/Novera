/**
 * Every way an agent's platform can answer, through the real HTTP adapter: one row per shape and
 * condition, each asserting the one outcome, who owns it and what the platform said. Then a
 * property test over arbitrary answers: the adapter never throws, never calls an empty answer a
 * reply, and never leaves a failure unclassified.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { httpAgent } from "../src/lib/agents/http.ts";
import type { AgentResult, FailureKind, HttpAgentConfig } from "../src/lib/agents/types.ts";
import { presetByKey } from "../src/lib/agents/presets.ts";
import { repairFor, type NoVerdictRow } from "../src/lib/evidence/repair.ts";
import { classifyPreflight } from "../src/lib/agents/preflight.ts";
import { assembleEventStream, isCumulative, looksLikeJsonLines } from "../src/lib/agents/sse.ts";
import { isLimitSignal, quotedReason, readUpstreamError, retryAfterMs, sanitiseUpstream, webPage } from "../src/lib/agents/upstream-error.ts";
import { parseEndpointFields } from "../src/lib/agents/connection.ts";
import { mockGuardedFetch } from "./guarded-fetch.ts";
import { setResolverForTests } from "../src/lib/net/public-url.ts";

setResolverForTests(async () => ["93.184.216.34"]);

const SSE = "text/event-stream";
const JSON_TYPE = "application/json";
const answer = (body: string, status = 200, contentType: string | null = JSON_TYPE, headers: Record<string, string> = {}) =>
  new Response(body, { status, headers: { ...(contentType ? { "content-type": contentType } : {}), ...headers } });
const events = (...data: unknown[]) => data.map((d) => `data: ${typeof d === "string" ? d : JSON.stringify(d)}\n\n`).join("");

const dify: HttpAgentConfig = { kind: "http", url: "https://api.dify.example/v1/chat-messages", bodyTemplate: presetByKey("dify")!.bodyTemplate, responsePath: "answer", streamPath: "answer", conversationIdPath: "conversation_id" };
const plain: HttpAgentConfig = { kind: "http", url: "https://agent.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" };
const openai: HttpAgentConfig = { kind: "http", url: "https://gw.example/v1/chat/completions", bodyTemplate: { model: "m", messages: "{{messages}}" }, responsePath: "choices.0.message.content" };
const workflow: HttpAgentConfig = { kind: "http", url: "https://api.dify.example/v1/workflows/run", bodyTemplate: presetByKey("dify-workflow")!.bodyTemplate, responsePath: "data.outputs.text", streamPath: "data.text" };

function row(error: string): NoVerdictRow {
  return { status: "error", error, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 };
}

interface Case {
  name: string;
  config: HttpAgentConfig;
  response: () => Response;
  ok?: string;
  kind?: FailureKind;
  said?: RegExp;
  reason?: string;
  owner?: string;
}

const CASES: Case[] = [
  // Replies.
  { name: "a Dify chatflow streams its answer in message events", config: dify, ok: "Hello there",
    response: () => answer(events({ event: "workflow_started" }, { event: "message", answer: "Hello", conversation_id: "c1" }, { event: "message", answer: " there" }, { event: "workflow_finished", data: { status: "succeeded", outputs: { answer: "Hello there" } } }, { event: "message_end" }), 200, SSE) },
  { name: "a chatflow whose answer arrives only in its final event", config: dify, ok: "Only at the end",
    response: () => answer(events({ event: "workflow_started" }, { event: "workflow_finished", data: { status: "succeeded", outputs: { answer: "Only at the end" } } }, { event: "message_end" }), 200, SSE) },
  { name: "a Dify workflow app streams text chunks, not doubled by its final outputs", config: workflow, ok: "Refund approved within policy.",
    response: () => answer(events({ event: "text_chunk", data: { text: "Refund approved " } }, { event: "text_chunk", data: { text: "within policy." } }, { event: "workflow_finished", data: { status: "succeeded", outputs: { text: "Refund approved within policy." } } }), 200, SSE) },
  { name: "a Dify workflow app answers blocking JSON", config: workflow, ok: "Escalate to a human.",
    response: () => answer(JSON.stringify({ workflow_run_id: "w", data: { status: "succeeded", outputs: { text: "Escalate to a human." } } })) },
  { name: "a structured workflow output is read as its JSON", config: { ...workflow, responsePath: "data.outputs" }, ok: '{\n  "decision": "refund",\n  "amount": 40\n}',
    response: () => answer(JSON.stringify({ data: { status: "succeeded", outputs: { decision: "refund", amount: 40 } } })) },
  { name: "chat completions stream deltas", config: openai, ok: "Hi there",
    response: () => answer(events({ choices: [{ delta: { role: "assistant", content: "" } }] }, { choices: [{ delta: { content: "Hi" } }] }, { choices: [{ delta: { content: " there" } }] }, "[DONE]"), 200, SSE) },
  { name: "JSON lines are read like a stream", config: plain, ok: "One two",
    response: () => answer('{"reply":"One "}\n{"reply":"two"}\n', 200, "application/x-ndjson") },
  { name: "the AI SDK text stream is read as its text parts", config: plain, ok: "Hello world",
    response: () => answer('f:{"messageId":"m"}\n0:"Hello "\n0:"world"\ne:{"finishReason":"stop"}\nd:{"finishReason":"stop"}\n', 200, "text/plain; charset=utf-8", { "x-vercel-ai-data-stream": "v1" }) },
  { name: "a stream of plain text events, declared", config: { ...plain, responsePath: "$text" }, ok: "plain words",
    response: () => answer("data: plain \n\ndata: words\n\n", 200, SSE) },
  { name: "a whole-text stream, declared as such, is its last event", config: { ...plain, streamMode: "whole" }, ok: "The full reply here",
    response: () => answer(events({ reply: "The full" }, { reply: "The full reply" }, { reply: "The full reply here" }), 200, SSE) },
  { name: "a value that is the last item of a list", config: { ...plain, responsePath: "messages.-1.content" }, ok: "last",
    response: () => answer(JSON.stringify({ messages: [{ content: "first" }, { content: "last" }] })) },

  // The agent said nothing.
  { name: "a chatflow that finished normally with no answer text", config: dify, kind: "empty", reason: "agent_malformed", owner: "your agent",
    response: () => answer(events({ event: "workflow_started" }, { event: "node_finished", data: { status: "succeeded" } }, { event: "workflow_finished", data: { status: "succeeded", outputs: { answer: "" } } }, { event: "message_end" }), 200, SSE) },
  { name: "a chatflow whose step failed and then finished empty", config: dify, kind: "empty", said: /HTTP Request: connection refused/,
    response: () => answer(events({ event: "node_finished", data: { title: "HTTP Request", status: "failed", error: "connection refused" } }, { event: "message_end" }), 200, SSE) },
  { name: "an empty JSON reply field", config: plain, kind: "empty", reason: "agent_malformed",
    response: () => answer(JSON.stringify({ reply: "" })) },
  { name: "an empty body", config: plain, kind: "unreadable", reason: "agent_malformed",
    response: () => answer("", 200, JSON_TYPE) },

  // The platform refused or failed, in its own words.
  { name: "a stream that ends in a rate-limit error (the run that prompted this)", config: dify, kind: "throttled", said: /too_many_requests: Too many requests/, reason: "agent_rate_limited", owner: "your agent",
    response: () => answer(events({ event: "error", status: 429, code: "too_many_requests", message: "Too many requests, please try again later." }), 200, SSE) },
  { name: "a stream that ends in a quota error", config: dify, kind: "throttled", said: /provider_quota_exceeded/, reason: "agent_rate_limited",
    response: () => answer(events({ event: "message", answer: "Par" }, { event: "error", status: 400, code: "provider_quota_exceeded", message: "Your quota of model credits has been used up." }), 200, SSE) },
  { name: "a stream that ends in a validation error", config: dify, kind: "platform_error", said: /invalid_param: customer_tier is required/, reason: "agent_platform_error", owner: "your agent",
    response: () => answer(events({ event: "error", status: 400, code: "invalid_param", message: "customer_tier is required in input form" }), 200, SSE) },
  { name: "a workflow that finished failed", config: dify, kind: "platform_error", said: /workflow_failed/, reason: "agent_platform_error",
    response: () => answer(events({ event: "workflow_finished", data: { status: "failed", error: "Variable #1.order_id# not found" } }), 200, SSE) },
  { name: "an OpenAI stream interrupted by an error object", config: openai, kind: "platform_error", said: /server_error: The server had an error/,
    response: () => answer(events({ choices: [{ delta: { content: "Hi" } }] }, { error: { message: "The server had an error", type: "server_error" } }), 200, SSE) },
  { name: "an Anthropic overloaded event", config: openai, kind: "throttled", said: /overloaded_error: Overloaded/, reason: "agent_rate_limited",
    response: () => answer("event: error\ndata: {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}\n\n", 200, SSE) },
  { name: "an error object answered with HTTP 200", config: plain, kind: "platform_error", said: /model_not_found: The model does not exist/, reason: "agent_platform_error",
    response: () => answer(JSON.stringify({ error: { code: "model_not_found", message: "The model does not exist" } })) },
  { name: "a failed blocking workflow", config: workflow, kind: "platform_error", said: /order_id/,
    response: () => answer(JSON.stringify({ data: { status: "failed", error: "Variable order_id is required", outputs: null } })) },
  { name: "HTTP 400 with the platform's reason", config: dify, kind: "refused_input", said: /invalid_param: inputs.customer_tier is required/, reason: "agent_http_error",
    response: () => answer(JSON.stringify({ code: "invalid_param", message: "inputs.customer_tier is required", status: 400 }), 400) },
  { name: "HTTP 401 with the platform's reason", config: dify, kind: "refused_auth", said: /unauthorized: Access token is invalid/, reason: "agent_http_error",
    response: () => answer(JSON.stringify({ code: "unauthorized", message: "Access token is invalid", status: 401 }), 401) },
  { name: "HTTP 429 with Retry-After", config: plain, kind: "throttled", reason: "agent_rate_limited",
    response: () => answer(JSON.stringify({ error: "rate limited" }), 429, JSON_TYPE, { "retry-after": "3" }) },
  { name: "HTTP 503 saying the model is over capacity", config: plain, kind: "throttled", said: /over capacity/,
    response: () => answer(JSON.stringify({ error: { message: "Model is over capacity", type: "overloaded" } }), 503) },
  { name: "HTTP 500 with a message", config: plain, kind: "platform_error", said: /internal: boom/, reason: "agent_http_error",
    response: () => answer(JSON.stringify({ code: "internal", message: "boom" }), 500) },
  { name: "HTTP 502 from a gateway", config: plain, kind: "unreachable",
    response: () => answer("Bad gateway", 502, "text/plain") },

  // Something else answered.
  { name: "a sign-in page answered with HTTP 200", config: plain, kind: "web_page", said: undefined, reason: "agent_blocked_page", owner: "your configuration",
    response: () => answer("<!doctype html><html><head><title>Sign in &amp; continue</title></head><body>…</body></html>", 200, "text/html") },
  { name: "a bot check answered with HTTP 403", config: plain, kind: "refused_auth",
    response: () => answer("<html><head><title>Just a moment...</title></head></html>", 403, "text/html") },
  { name: "a redirect", config: plain, kind: "redirect", reason: "agent_http_error",
    response: () => new Response(null, { status: 308, headers: { location: "https://www.agent.example/chat" } }) },

  // The connection reads in the wrong place.
  { name: "a JSON reply at another path", config: plain, kind: "path_miss", reason: "agent_response_path", owner: "your configuration",
    response: () => answer(JSON.stringify({ data: { text: "hi" } })) },
  { name: "a stream whose text is in a field the connection does not read", config: dify, kind: "path_miss", reason: "agent_response_path",
    response: () => answer(events({ event: "agent_message", text: "hi" }, { event: "message_end" }), 200, SSE) },
  { name: "a whole-text stream read as pieces", config: plain, kind: "repeated_stream", reason: "agent_stream_repeats", owner: "your configuration",
    response: () => answer(events({ reply: "Thanks for" }, { reply: "Thanks for writing" }, { reply: "Thanks for writing in." }), 200, SSE) },
  { name: "text that is not JSON on a JSON connection", config: plain, kind: "unreadable", reason: "agent_malformed",
    response: () => answer("hello", 200, "text/plain") },
];

for (const c of CASES) {
  test(`wire: ${c.name}`, async (t) => {
    mockGuardedFetch(t, async () => c.response());
    const result = await httpAgent(c.config).send({ input: "hi", policy: "" });
    if (c.ok !== undefined) {
      assert.equal(result.ok, true, result.error);
      assert.equal(result.responseText, c.ok);
      assert.equal(result.failure, undefined);
      return;
    }
    assert.equal(result.ok, false);
    assert.equal(result.responseText, null, "a failure never carries reply text");
    assert.equal(result.failure?.kind, c.kind, result.error);
    assert.ok(result.failure?.signature, "every failure has a signature to count one cause by");
    if (c.said) {
      assert.match(result.error ?? "", c.said);
      assert.match(result.error ?? "", /said: "/, "the platform's words are quoted");
    }
    const repair = repairFor(row(result.error ?? ""));
    assert.ok(repair);
    assert.notEqual(repair.reason, "unclassified", `${c.name}: ${result.error}`);
    if (c.reason) assert.equal(repair.reason, c.reason, `${c.name}: ${result.error}`);
    if (c.owner) assert.equal(repair.owner, c.owner);
    if (c.said) assert.match(repair.happened, c.said, "the run page shows the platform's words");
    const check = classifyPreflight(result, c.config);
    assert.equal(check.ok, false);
    assert.ok(check.headline && check.detail);
  });
}

test("a 429's Retry-After is read in seconds or as a date, never past 20 s", async (t) => {
  mockGuardedFetch(t, async () => answer("{}", 429, JSON_TYPE, { "retry-after": "3" }));
  const r = await httpAgent(plain).send({ input: "hi", policy: "" });
  assert.deepEqual(r.failure, { kind: "throttled", signature: "http:429", refusedAtDoor: true, retryAfterMs: 3000 });
  assert.equal(retryAfterMs("120"), 20_000);
  assert.equal(retryAfterMs(new Date(Date.now() + 4_000).toUTCString()) !== undefined, true);
  assert.equal(retryAfterMs("soon"), undefined);
  assert.equal(retryAfterMs("-1"), undefined);
});

test("the platform's words are cleaned before they are stored: one line, bounded, patterns redacted", () => {
  const said = sanitiseUpstream(`bad key sk-ant-abc123abc123abc123abc123 for jane.doe@example.com\n\u0000${"x".repeat(400)}`);
  assert.ok(!said.includes("jane.doe@example.com"), said);
  assert.ok(!/[\n\u0000]/.test(said));
  assert.ok(said.length <= 320);
  assert.equal(quotedReason('The agent\'s stream ended with an error (too_many_requests: Too many).'), "too_many_requests: Too many", "the older stored wording still yields its reason");
  assert.equal(quotedReason('Agent returned HTTP 400. Its platform said: "invalid_param: x".'), "invalid_param: x");
  assert.equal(quotedReason("Agent returned HTTP 400"), null);
});

test("only explicit error shapes are errors: a reply that mentions an error is a reply", () => {
  assert.equal(readUpstreamError({ answer: "There was an error with your order, so I refunded it." }), null);
  assert.equal(readUpstreamError({ event: "message", answer: "x" }), null);
  assert.equal(readUpstreamError({ data: { status: "succeeded", error: null, outputs: {} } }), null);
  assert.deepEqual(readUpstreamError({ detail: "Not authenticated" }), { code: null, message: "Not authenticated", status: null });
  assert.deepEqual(readUpstreamError({ errors: [{ message: "Field missing" }] })?.message, "Field missing");
  assert.equal(isLimitSignal({ code: "invalid_param", message: "customer_tier is required", status: 400 }), false);
  assert.equal(isLimitSignal({ code: null, message: "Resource has been exhausted (e.g. check quota).", status: null }), true);
  assert.equal(isLimitSignal(null, 429), true);
});

test("a stream of next-pieces is never mistaken for one that repeats the text so far", () => {
  assert.equal(isCumulative(["I", "I'm"]), false, "two short pieces can line up by chance");
  assert.equal(isCumulative(["Hello", " there", " friend"]), false);
  assert.equal(isCumulative(["Thank you for", "Thank you for writing"]), true);
  assert.equal(isCumulative(["a", "ab", "abc"]), true);
  // A cumulative stream read as pieces is refused, never graded doubled.
  const doubled = assembleEventStream(events({ reply: "Thanks for" }, { reply: "Thanks for writing" }), ["reply"]);
  assert.equal(doubled.text, null);
  assert.equal(doubled.cumulative, true);
});

test("a web page is recognised by its type or how it begins, never by a reply that mentions HTML", () => {
  assert.equal(webPage("text/html; charset=utf-8", "<p>hi</p>")?.title, null);
  assert.equal(webPage(null, "<!DOCTYPE html><title>Login</title>")?.title, "Login");
  assert.equal(webPage(JSON_TYPE, '{"reply":"<html> is a tag"}'), null);
  assert.equal(looksLikeJsonLines(null, '{"a":1}'), false, "one line is JSON, not JSON lines");
});

test("a credential in the address's query string is refused at saving, with where it belongs", () => {
  const fields = { bodyTemplate: '{"message":"{{input}}"}', responsePath: "reply", toolActivityPath: "", authHeaderName: "" };
  for (const url of ["https://fn.example/api/chat?code=abc", "https://x.example/chat?api_key=abc", "https://x.example/chat?token=abc"]) {
    const parsed = parseEndpointFields({ url, ...fields });
    assert.equal(parsed.ok, false, url);
    assert.match((parsed as { error: string }).error, /Authentication/);
  }
  assert.equal(parseEndpointFields({ url: "https://x.example/chat?lang=en", ...fields }).ok, true);
  assert.equal(parseEndpointFields({ url: "https://x.example/c/{{conversation_id}}?v=2", ...fields }).ok, true);
});

test("a GET connection sends no body, so the request is made rather than refused as unreachable", async (t) => {
  const seen: Array<RequestInit | undefined> = [];
  mockGuardedFetch(t, async (_url, init) => {
    seen.push(init as RequestInit);
    return answer(JSON.stringify({ reply: "ok" }));
  });
  const r = await httpAgent({ ...plain, method: "GET" }).send({ input: "hi", policy: "" });
  assert.equal(r.ok, true);
  assert.equal(seen[0]?.body, undefined);
});

// ---------------------------------------------------------------- property: whatever arrives

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const FRAGMENTS = [
  "", " ", "{", "}", '{"reply":', '"hi"', '""', "null", "[]", '{"answer":"x"}', "data: ", "event: error\n", "\n\n", "\n",
  '{"event":"error","code":"x"}', '{"event":"message_end"}', '{"error":{"message":"m"}}', "<html>", "<title>t</title>", "0:\"a\"\n",
  "\u0000", "\ud800", "é", "[DONE]", '{"choices":[{"delta":{"content":"a"}}]}', '{"data":{"status":"failed","error":"e"}}',
];
const TYPES = [null, JSON_TYPE, SSE, "text/plain", "text/html", "application/x-ndjson", "application/octet-stream"];
const STATUSES = [200, 201, 204, 301, 400, 401, 403, 404, 408, 413, 422, 429, 500, 502, 503, 504];
const CONFIGS = [plain, dify, openai, workflow, { ...plain, responsePath: "$text" }, { ...plain, streamMode: "whole" as const }];

test("property: any status, type and body gives a result, never a throw, an empty reply or an unclassified failure", async (t) => {
  const next = rng(20261113);
  let current: () => Response = () => answer("{}");
  mockGuardedFetch(t, async () => current());
  for (let i = 0; i < 400; i++) {
    const status = STATUSES[Math.floor(next() * STATUSES.length)];
    const type = TYPES[Math.floor(next() * TYPES.length)];
    const body = Array.from({ length: Math.floor(next() * 8) }, () => FRAGMENTS[Math.floor(next() * FRAGMENTS.length)]).join("");
    const config = CONFIGS[Math.floor(next() * CONFIGS.length)];
    current = () => (status === 204 || status === 301 ? new Response(null, { status, headers: status === 301 ? { location: "https://a.example/" } : {} }) : answer(body, status, type));
    let result: AgentResult;
    try {
      result = await httpAgent(config).send({ input: "hi", policy: "" });
    } catch (thrown) {
      assert.fail(`threw on ${status} ${type} ${JSON.stringify(body)}: ${String(thrown)}`);
    }
    const where = `${status} ${type} ${JSON.stringify(body)} via ${config.responsePath}`;
    if (result.ok) {
      assert.ok(typeof result.responseText === "string" && result.responseText.trim() !== "", `ok with no text: ${where}`);
      assert.ok(status >= 200 && status < 300, `ok on a non-2xx: ${where}`);
    } else {
      assert.equal(result.responseText, null, where);
      assert.ok(result.failure, `no classified failure: ${where}`);
      const repair = repairFor(row(result.error ?? ""));
      assert.notEqual(repair?.reason, "unclassified", `unclassified: ${where} → ${result.error}`);
    }
  }
});
