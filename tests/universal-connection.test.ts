/**
 * Connecting any agent without a relay in between: presets, a pasted curl command, streamed and
 * plain-text replies, conversation ids the agent issues, and delivery in the message for a
 * request with no field for metadata or earlier turns — plus what a run then declares and a
 * report states. Fictional hosts only (`.example`).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readPath, replyText } from "../src/lib/agents/template.ts";
import { assembleEventStream, looksLikeEventStream, parseEventStream, streamPaths } from "../src/lib/agents/sse.ts";
import { contextBlock, deliveryOf, historyBlock, messageFor, requestBody } from "../src/lib/agents/delivery.ts";
import { httpAgent } from "../src/lib/agents/http.ts";
import type { HttpAgentConfig } from "../src/lib/agents/types.ts";
import { PRESETS, detectPreset, normalisePresetUrl, presetByKey, presetFormValues } from "../src/lib/agents/presets.ts";
import { importCurl, parseCurl, shellWords, templateFromBody } from "../src/lib/agents/curl.ts";
import {
  newHttpConfig, nextHttpConfig, normaliseCredential, parseBodyTemplate, parseEndpointFields, parseExtraHeaders,
} from "../src/lib/agents/connection.ts";
import { classifyPreflight, deliveryNotes, inspectPreflight } from "../src/lib/agents/preflight.ts";
import { agentConfigHash, buildRunManifest, compositionFromManifest, inMessageCaseIds } from "../src/lib/report/manifest.ts";
import { executeCase, afterSecondAttempt, worthOneMoreAttempt } from "../src/lib/runner/execute.ts";
import { repairFor } from "../src/lib/evidence/repair.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";
import { setResolverForTests } from "../src/lib/net/public-url.ts";
import { mockGuardedFetch } from "./guarded-fetch.ts";
import type { AgentAdapter, AgentResult } from "../src/lib/agents/types.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

setResolverForTests(async () => ["93.184.216.34"]);

const v7 = JSON.parse(readFileSync("data/suites/eu-support-v7.json", "utf8")) as { cases: SuiteCase[] };
const scenario = (id: string) => v7.cases.find((c) => c.id === id) as SuiteCase;

// ------------------------------------------------------------------ reply paths and streams

test("a * path reads one field from every element, and the reply is those lines in order", () => {
  const traces = [
    { type: "text", payload: { message: "Hello." } },
    { type: "visual", payload: { image: "x" } },
    { type: "text", payload: { message: "How can I help?" } },
  ];
  assert.deepEqual(readPath(traces, "*.payload.message"), ["Hello.", "How can I help?"]);
  assert.equal(replyText(traces, "*.payload.message"), "Hello.\nHow can I help?");
  assert.equal(replyText(traces, "*.payload.nothing"), undefined);
  // A list at a plain path is not a reply: only a * path joins.
  assert.equal(replyText({ reply: ["a", "b"] }, "reply"), undefined);
  assert.equal(replyText({ reply: "a" }, "reply"), "a");
});

test("a streamed answer is its pieces in order; a replacement replaces; an error is an error", () => {
  const dify = [
    'data: {"event":"message","answer":"I can ","conversation_id":"c-1"}', "",
    'data: {"event":"agent_thought","tool":"order_lookup","thought":""}', "",
    'data: {"event":"agent_message","answer":"help with that."}', "",
    'data: {"event":"message_end","metadata":{}}', "", "",
  ].join("\n");
  assert.equal(looksLikeEventStream("text/event-stream; charset=utf-8", dify), true);
  assert.equal(looksLikeEventStream("application/json", '{"answer":"x"}'), false);
  assert.equal(looksLikeEventStream(null, dify), true, "recognised by how it begins when the type is missing");
  const got = assembleEventStream(dify, streamPaths("answer"));
  assert.equal(got.text, "I can help with that.");
  assert.equal(got.pieces, 2);
  assert.equal(got.matchedPath, "answer");

  // An output filter withdrew what was streamed: the customer sees the substitute only.
  const replaced = dify.replace('data: {"event":"message_end","metadata":{}}', 'data: {"event":"message_replace","answer":"I cannot share that."}');
  assert.equal(assembleEventStream(replaced, ["answer"]).text, "I cannot share that.");

  const failed = 'data: {"event":"message","answer":"Par"}\n\ndata: {"event":"error","status":400,"code":"invalid_param","message":"bad input"}\n\n';
  const err = assembleEventStream(failed, ["answer"]);
  assert.equal(err.text, null);
  assert.match(err.error ?? "", /stream ended with an error \(invalid_param: bad input\)/);

  // A chat-completion stream: the reply path's streaming spelling, and the end marker ignored.
  const openai = 'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\ndata: {"choices":[{"delta":{"content":"Hi"}}]}\n\ndata: {"choices":[{"delta":{"content":" there"}}]}\n\ndata: [DONE]\n\n';
  assert.deepEqual(streamPaths("choices.0.message.content"), ["choices.0.message.content", "choices.0.delta.content"]);
  assert.equal(assembleEventStream(openai, streamPaths("choices.0.message.content")).text, "Hi there");
  assert.equal(parseEventStream(openai).length, 3);
  // Nothing readable is null, never an empty reply.
  assert.equal(assembleEventStream('data: {"event":"ping"}\n\n', ["answer"]).text, null);
});

const stream = (body: string, status = 200) => new Response(body, { status, headers: { "content-type": "text/event-stream" } });
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

test("the adapter reads a stream, a plain-text reply and an empty reply for what they are", async (t) => {
  const dify: HttpAgentConfig = { kind: "http", url: "https://dify.example/v1/chat-messages", bodyTemplate: presetByKey("dify")!.bodyTemplate, responsePath: "answer", streamPath: "answer", conversationIdPath: "conversation_id" };
  mockGuardedFetch(t, async () => stream('data: {"event":"message","answer":"Hello","conversation_id":"c-9"}\n\ndata: {"event":"message","answer":" there"}\n\n'));
  const streamed = await httpAgent(dify).send({ input: "hi", policy: "" });
  assert.equal(streamed.ok, true);
  assert.equal(streamed.responseText, "Hello there");
  assert.deepEqual(streamed.wire, { contentType: "text/event-stream", format: "event_stream", pieces: 2, matchedPath: "answer" });

  mockGuardedFetch(t, async () => new Response("Hello from a plain endpoint", { status: 200, headers: { "content-type": "text/plain" } }));
  const notDeclared = await httpAgent({ kind: "http", url: "https://plain.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" }).send({ input: "hi", policy: "" });
  assert.equal(notDeclared.ok, false, "plain text is read as the reply only when the connection says so");
  const declared = await httpAgent({ kind: "http", url: "https://plain.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "$text" }).send({ input: "hi", policy: "" });
  assert.equal(declared.responseText, "Hello from a plain endpoint");

  mockGuardedFetch(t, async () => json({ reply: "" }));
  const empty = await httpAgent({ kind: "http", url: "https://quiet.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" }).send({ input: "hi", policy: "" });
  assert.equal(empty.ok, false);
  assert.equal(empty.emptyReply, true);
  assert.equal(empty.error, "The agent answered with an empty reply.");
  // A reply somewhere else in the answer is still a wrong path, not silence.
  mockGuardedFetch(t, async () => json({ answer: "here" }));
  const elsewhere = await httpAgent({ kind: "http", url: "https://quiet.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" }).send({ input: "hi", policy: "" });
  assert.equal(elsewhere.emptyReply, undefined);
  assert.match(elsewhere.error ?? "", /^No text found at response path/);
});

test("a platform that issues conversation ids is sent none first, then the one it returned", async (t) => {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  mockGuardedFetch(t, async (input, init) => {
    sent.push({ url: String(input), body: JSON.parse(String((init as RequestInit).body)) as Record<string, unknown> });
    return json({ answer: `reply ${sent.length}`, conversation_id: "issued-77" });
  });
  const agent = httpAgent({ kind: "http", url: "https://dify.example/v1/chat-messages", bodyTemplate: { inputs: {}, query: "{{input}}", conversation_id: "{{conversation_id}}" }, responsePath: "answer", conversationIdPath: "conversation_id" });
  await agent.send({ input: "one", policy: "", conversationId: "novera-1", history: [] });
  await agent.send({ input: "two", policy: "", conversationId: "novera-1", history: [{ role: "customer", content: "one" }, { role: "agent", content: "reply 1" }] });
  await agent.send({ input: "other scenario", policy: "", conversationId: "novera-2" });
  assert.deepEqual(sent.map((s) => s.body.conversation_id), ["", "issued-77", ""], "never Novera's own id, and never another conversation's");
  assert.equal(agent.acceptsConversation?.(), true);

  // An address that keys the conversation: only in the path, encoded, one per conversation.
  sent.length = 0;
  const byUrl = httpAgent({ kind: "http", url: "https://runtime.example/state/user/{{conversation_id}}/interact", bodyTemplate: { action: { type: "text", payload: "{{input}}" } }, responsePath: "*.payload.message" });
  mockGuardedFetch(t, async (input) => { sent.push({ url: String(input), body: {} }); return json([{ type: "text", payload: { message: "ok" } }]); });
  const r = await byUrl.send({ input: "hi", policy: "", conversationId: "a b/c" });
  assert.equal(r.responseText, "ok");
  assert.equal(sent[0].url, "https://runtime.example/state/user/a%20b%2Fc/interact");
});

// ------------------------------------------------------------------ delivery

test("a request with no field for metadata or earlier turns sends them in the message only when the connection says so", () => {
  const plain = { url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" } };
  assert.deepEqual(deliveryOf(plain), { context: "none", conversation: "none" });
  assert.deepEqual(deliveryOf({ ...plain, inlineChannels: true }), { context: "message", conversation: "message" });
  // A field of its own always wins: the option changes nothing for a request that has one.
  assert.deepEqual(deliveryOf({ url: plain.url, bodyTemplate: { message: "{{input}}", meta: "{{context}}", messages: "{{messages}}" }, inlineChannels: true }), { context: "field", conversation: "field" });

  const t42 = scenario("T42");
  assert.equal(messageFor(plain, t42.input, t42.context), t42.input, "off: the message is the scenario's own text");
  const inlined = messageFor({ ...plain, inlineChannels: true }, t42.input, t42.context);
  assert.equal(inlined, `${contextBlock(t42.context!)}\n\n${t42.input}`);
  assert.ok(inlined.includes(t42.context!.retrieved_article), "the content is verbatim");
  assert.ok(inlined.startsWith("[retrieved_article]\n"), "labelled by the scenario's own key, with nothing telling the agent how to treat it");
  assert.equal(/not written by|ignore|do not follow|untrusted/i.test(contextBlock(t42.context!).replace(t42.context!.retrieved_article, "")), false);

  const history = [{ role: "customer" as const, content: "Can you check X?" }, { role: "agent" as const, content: "It is active." }];
  assert.equal(historyBlock(history), "[Earlier in this conversation]\nCustomer: Can you check X?\nAssistant: It is active.\n[/Earlier in this conversation]");
  const body = requestBody({ kind: "http", ...plain, responsePath: "reply", inlineChannels: true }, { input: "Cancel all.", policy: "", history, conversationId: "c" }) as { message: string };
  assert.ok(body.message.endsWith("\n\nCancel all."));
  assert.ok(body.message.startsWith("[Earlier in this conversation]"));

  // {{messages}} is the whole chat list, ending with this message, as a list and not a string.
  const chat = requestBody({ kind: "http", url: "https://llm.example/v1/chat/completions", bodyTemplate: { model: "m", messages: "{{messages}}" }, responsePath: "choices.0.message.content" }, { input: "Cancel all.", policy: "", history, conversationId: "c" }) as { messages: unknown[] };
  assert.deepEqual(chat.messages, [{ role: "user", content: "Can you check X?" }, { role: "assistant", content: "It is active." }, { role: "user", content: "Cancel all." }]);
});

const scripted = (reply: (input: string) => AgentResult, how: { context: boolean; conversation: boolean }, sent: string[] = []): AgentAdapter => ({
  probe: async () => reply("probe"),
  send: async (invocation) => { sent.push(invocation.input); return reply(invocation.input); },
  acceptsContext: () => how.context,
  acceptsConversation: () => how.conversation,
});
const neverJudge = (async () => { throw new Error("no model in this test"); }) as never;

test("the metadata and conversation scenarios run on a plain endpoint with the option on, and are not sent with it off", async (t) => {
  const bodies: string[] = [];
  mockGuardedFetch(t, async (_input, init) => { bodies.push(String((init as RequestInit).body)); return json({ reply: "Go to Billing, then Invoices." }); });
  const off = httpAgent({ kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" });
  for (const id of ["T29", "T42", "T49"]) {
    const outcome = await executeCase({ testCase: scenario(id), agent: off, policy: "p", judge: neverJudge });
    assert.match(outcome.error ?? "", /^This scenario delivers its input as conversation metadata/, id);
    assert.match(outcome.error ?? "", /tick the delivery option/, "the refusal names the way through");
  }
  const t43 = await executeCase({ testCase: scenario("T43"), agent: off, policy: "p", judge: neverJudge });
  assert.match(t43.error ?? "", /^This scenario is a conversation, and this agent's request template has no/);
  assert.equal(bodies.length, 0, "nothing was sent");

  const on = httpAgent({ kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply", inlineChannels: true });
  assert.equal(on.acceptsContext(), true);
  assert.equal(on.acceptsConversation?.(), true);
  // T43 has a turn rule that can fail it without a model; a reply that breaks none goes on to the
  // graders, which this test does not have: the point here is what reached the agent.
  await executeCase({ testCase: scenario("T43"), agent: on, policy: "p", judge: neverJudge }).catch(() => null);
  assert.equal(bodies.length, 2, "both turns were sent");
  const second = (JSON.parse(bodies[1]) as { message: string }).message;
  assert.ok(second.includes("Customer: Can you check the cancellation status of the Northwind Studio workspace?"));
  assert.ok(second.includes("Assistant: Go to Billing, then Invoices."), "with the agent's own first reply");
  assert.ok(second.endsWith(scenario("T43").input));
});

test("a run declares which scenarios go in the message before it runs, and its report states them", () => {
  const plain = { kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" };
  assert.equal(inMessageCaseIds(plain, v7.cases), null);
  const declared = inMessageCaseIds({ ...plain, inlineChannels: true }, v7.cases);
  assert.deepEqual(declared, { context: ["T29", "T42", "T49"], conversation: ["T43"] });
  // A request with its own fields declares nothing, option or not.
  assert.equal(inMessageCaseIds({ ...plain, bodyTemplate: { message: "{{input}}", c: "{{context}}", h: "{{history}}" }, inlineChannels: true }, v7.cases), null);

  const base = {
    runId: "r", agentId: "a", policyId: "p", policyVersion: 1, suiteId: "s", suiteKey: "eu-support", suiteVersion: 7,
    caseIds: v7.cases.map((c) => c.id), judgeSource: "trial_free" as const, passThreshold: 80, runnerVersion: "1", createdAt: "2026-11-12T00:00:00.000Z",
  };
  const without = buildRunManifest({ ...base, agentConfig: plain });
  assert.equal("in_message" in without.manifest, false);
  assert.equal(compositionFromManifest(without.manifest).delivery, null);
  const withIt = buildRunManifest({ ...base, agentConfig: { ...plain, inlineChannels: true }, inMessage: declared });
  assert.deepEqual(withIt.manifest.in_message, declared);
  assert.notEqual(withIt.hash, without.hash, "it is part of what the run declared");
  const delivery = compositionFromManifest(JSON.parse(JSON.stringify(withIt.manifest))).delivery!;
  assert.deepEqual(delivery.in_message, { context: ["T29", "T42", "T49"], conversation: ["T43"] });
  assert.match(delivery.note, /Scenarios T29, T42, T49 carry content the customer did not type/);
  assert.match(delivery.note, /Scenario T43 is a conversation/);
  assert.match(delivery.note, /A failure in these scenarios is a failure either way\. A pass shows .* it does not show/);
  assert.deepEqual(scanCustomerLanguage(delivery.note), []);

  // The request digest moves only for a connection that uses the new settings.
  assert.equal(agentConfigHash(plain), agentConfigHash({ ...plain, preset: "custom" }), "the starting point is not part of the request");
  assert.notEqual(agentConfigHash(plain), agentConfigHash({ ...plain, inlineChannels: true }));
  assert.notEqual(agentConfigHash(plain), agentConfigHash({ ...plain, conversationIdPath: "conversation_id" }));
});

// ------------------------------------------------------------------ presets and the form

test("every preset is a connection the parser accepts, and none needs code of its own", () => {
  assert.ok(PRESETS.length >= 7);
  for (const preset of PRESETS) {
    const v = presetFormValues(preset);
    const parsed = parseEndpointFields({ url: preset.urlExample, ...v, timeoutSeconds: "" });
    assert.equal(parsed.ok, true, `${preset.key}: ${"error" in parsed ? parsed.error : ""}`);
    const config = newHttpConfig((parsed as { value: Parameters<typeof newHttpConfig>[0] }).value);
    assert.equal(config.preset, preset.key);
    // Every platform preset can carry a conversation by its own means.
    if (preset.key !== "custom") assert.equal(deliveryOf(config).conversation, "field", preset.key);
  }
  const dify = presetByKey("dify")!;
  assert.deepEqual(dify.bodyTemplate, { inputs: {}, query: "{{input}}", response_mode: "streaming", user: "novera-evaluation", conversation_id: "{{conversation_id}}" });
  assert.equal(dify.conversationIdPath, "conversation_id");
});

test("an address is recognised by its host and path, and an API base is completed only where the platform documents it", () => {
  assert.equal(detectPreset("https://api.dify.ai/v1")?.key, "dify");
  assert.equal(detectPreset("https://dify.internal.example/v1/chat-messages")?.key, "dify");
  assert.equal(detectPreset("https://gateway.example/v1/chat/completions")?.key, "openai");
  assert.equal(detectPreset("https://general-runtime.voiceflow.com/state/user/{{conversation_id}}/interact")?.key, "voiceflow");
  assert.equal(detectPreset("https://flow.example/api/v1/prediction/abc-123")?.key, "flowise");
  assert.equal(detectPreset("https://n8n.example/webhook/abc/chat")?.key, "n8n");
  assert.equal(detectPreset("https://api.example.com/support/chat"), null);
  assert.equal(detectPreset("not a url"), null);

  assert.equal(normalisePresetUrl("dify", "https://api.dify.ai/v1").url, "https://api.dify.ai/v1/chat-messages");
  assert.equal(normalisePresetUrl("dify", "https://api.dify.ai/v1/").url, "https://api.dify.ai/v1/chat-messages");
  assert.match(normalisePresetUrl("dify", "https://api.dify.ai").note ?? "", /chat-messages was added/);
  assert.deepEqual(normalisePresetUrl("dify", "https://api.dify.ai/v1/chat-messages"), { url: "https://api.dify.ai/v1/chat-messages", note: null });
  assert.equal(normalisePresetUrl("openai", "https://gateway.example/v1").url, "https://gateway.example/v1/chat/completions");
  assert.equal(normalisePresetUrl("custom", "https://api.dify.ai/v1").note, null, "nothing is guessed for a custom endpoint");
});

test("the request body may carry {{messages}} instead of {{input}}; an address may carry only {{conversation_id}}, after the host", () => {
  assert.equal(parseBodyTemplate('{"model":"m","messages":"{{messages}}"}').ok, true);
  assert.equal(parseBodyTemplate('{"model":"m"}').ok, false);
  const fields = { bodyTemplate: '{"m":"{{input}}"}', responsePath: "reply", toolActivityPath: "", authHeaderName: "" };
  assert.equal(parseEndpointFields({ ...fields, url: "https://rt.example/state/user/{{conversation_id}}/interact" }).ok, true);
  assert.equal(parseEndpointFields({ ...fields, url: "https://{{conversation_id}}.example/chat" }).ok, false);
  assert.equal(parseEndpointFields({ ...fields, url: "https://rt.example/{{input}}" }).ok, false);
  assert.equal(parseEndpointFields({ ...fields, url: "https://rt.example/chat", responsePath: "$text" }).ok, true);
  assert.equal(parseEndpointFields({ ...fields, url: "https://rt.example/chat", responsePath: "*.payload.message" }).ok, true);
  assert.equal(parseEndpointFields({ ...fields, url: "https://rt.example/chat", responsePath: "a..b" }).ok, false);
  // An id read from the reply has to have somewhere to be sent back.
  const orphan = parseEndpointFields({ ...fields, url: "https://rt.example/chat", conversationIdPath: "conversation_id" });
  assert.equal(orphan.ok, false);
});

test("other headers are stored as written, so a header that carries a credential is refused there", () => {
  assert.deepEqual(parseExtraHeaders("anthropic-version: 2023-06-01\n\nx-tenant: acme"), { ok: true, value: { "anthropic-version": "2023-06-01", "x-tenant": "acme" } });
  for (const line of ["Authorization: Bearer abc", "x-api-key: abc", "Cookie: s=1", "X-Auth-Token: abc", "api-secret: abc"]) {
    const refused = parseExtraHeaders(line);
    assert.equal(refused.ok, false, line);
    assert.match((refused as { error: string }).error, /under Authentication, where it is encrypted/);
    assert.equal((refused as { error: string }).error.includes("abc"), false, "the value is never repeated");
  }
  assert.equal(parseExtraHeaders("content-type: text/plain").ok, false);
  assert.equal(parseExtraHeaders("no colon here").ok, false);
  assert.equal(parseExtraHeaders(Array.from({ length: 11 }, (_, i) => `x-h${i}: v`).join("\n")).ok, false);

  // A caller that does not send the new fields keeps what the agent has; the form replaces them.
  const current: HttpAgentConfig = { kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply", headers: { "x-tenant": "acme" }, inlineChannels: true };
  const base = { name: "Bot", url: current.url, bodyTemplate: '{"message":"{{input}}"}', responsePath: "reply", toolActivityPath: "", timeoutSeconds: "", authHeaderName: "" };
  const old = parseEndpointFields(base) as { value: Parameters<typeof newHttpConfig>[0] };
  assert.deepEqual(nextHttpConfig(current, { ...old.value, name: "Bot", credential: "keep" }).headers, { "x-tenant": "acme" });
  assert.equal(nextHttpConfig(current, { ...old.value, name: "Bot", credential: "keep" }).inlineChannels, true);
  const form = parseEndpointFields({ ...base, headers: "", inlineChannels: null }) as { value: Parameters<typeof newHttpConfig>[0] };
  const cleared = nextHttpConfig(current, { ...form.value, name: "Bot", credential: "keep" });
  assert.equal(cleared.headers, undefined);
  assert.equal(cleared.inlineChannels, undefined);
});

test("a bare token under authorization is sent as Bearer; anything else is sent as pasted", () => {
  assert.deepEqual(normaliseCredential("Authorization", "app-abc123"), { value: "Bearer app-abc123", note: "The credential was a bare token, so it is sent as “Authorization: Bearer …”." });
  assert.equal(normaliseCredential("authorization", "sk-abc123").value, "Bearer sk-abc123");
  assert.equal(normaliseCredential("authorization", "Bearer sk-abc123").value, "Bearer sk-abc123");
  assert.equal(normaliseCredential("authorization", "Basic dXNlcjpwYXNz").note, null);
  // A platform key that is sent without a scheme stays without one.
  assert.equal(normaliseCredential("authorization", "VF.DM.abc.def").value, "VF.DM.abc.def");
  assert.equal(normaliseCredential("x-api-key", "sk-abc123").value, "sk-abc123");
  assert.equal(normaliseCredential(null, "sk-abc123").value, "sk-abc123");
  assert.equal(normaliseCredential("authorization", "app-abc123").note?.includes("app-abc123"), false);
});

// ------------------------------------------------------------------ curl

test("a curl command is read into words as a shell would, and never run", () => {
  assert.deepEqual(shellWords(`curl -X POST 'https://a.example/x' \\\n  -H "A: b c" -d '{"q": "it'\\''s"}'`), ["curl", "-X", "POST", "https://a.example/x", "-H", "A: b c", "-d", `{"q": "it's"}`]);
  assert.deepEqual(shellWords("curl $'a\\nb'"), ["curl", "a\nb"]);
  const parsed = parseCurl(`curl --location --request POST 'https://api.dify.ai/v1/chat-messages' --header 'Authorization: Bearer app-KEY' --header 'Content-Type: application/json' --data-raw '{"inputs": {}, "query": "What are the specs?", "response_mode": "streaming", "conversation_id": "", "user": "abc-123"}'`);
  assert.ok(!("error" in parsed));
  assert.equal((parsed as { method: string }).method, "POST");
  assert.equal((parsed as { url: string }).url, "https://api.dify.ai/v1/chat-messages");
  assert.match((parseCurl("wget https://a.example") as { error: string }).error, /does not look like a curl command/);
  assert.match((parseCurl("curl -X POST") as { error: string }).error, /no address/);
});

test("importing Dify's documented command fills a working connection and puts the key in the credential field", () => {
  const got = importCurl(`curl -X POST 'https://api.dify.ai/v1/chat-messages' \\
    --header 'Authorization: Bearer app-REALKEY123' \\
    --header 'Content-Type: application/json' \\
    --data-raw '{"inputs": {}, "query": "What are the specs of the iPhone 13 Pro Max?", "response_mode": "streaming", "conversation_id": "", "user": "abc-123"}'`);
  assert.ok(!("error" in got));
  const { values, found, todo } = got as Exclude<typeof got, { error: string }>;
  assert.equal(values.preset, "dify");
  assert.equal(values.authHeaderName, "authorization");
  assert.equal(values.authValue, "Bearer app-REALKEY123");
  assert.deepEqual(JSON.parse(values.bodyTemplate!), { inputs: {}, query: "{{input}}", response_mode: "streaming", conversation_id: "{{conversation_id}}", user: "abc-123" });
  assert.equal(values.responsePath, "answer");
  assert.equal(values.conversationIdPath, "conversation_id");
  assert.equal(values.headers, undefined, "content-type is Novera's own");
  assert.equal([...found, ...todo].join(" ").includes("REALKEY123"), false, "what was read never repeats the credential");
  const parsed = parseEndpointFields({ url: values.url, bodyTemplate: values.bodyTemplate, responsePath: values.responsePath, toolActivityPath: "", authHeaderName: values.authHeaderName, headers: "", conversationIdPath: values.conversationIdPath, streamPath: values.streamPath });
  assert.equal(parsed.ok, true, "error" in parsed ? parsed.error : "");
});

test("a chat list becomes {{messages}}, a placeholder key is called out, and a second credential is left out", () => {
  const got = importCurl(`curl https://gateway.example/v1/chat/completions -H "Authorization: Bearer $OPENAI_API_KEY" -H "x-api-key: <your key>" -H "X-Team: support" -d '{"model": "support-agent", "messages": [{"role": "system", "content": "You are helpful."}, {"role": "user", "content": "Hello!"}]}'`);
  assert.ok(!("error" in got));
  const { values, todo } = got as Exclude<typeof got, { error: string }>;
  assert.deepEqual(JSON.parse(values.bodyTemplate!), { model: "support-agent", messages: "{{messages}}" });
  assert.equal(values.preset, "openai");
  assert.equal(values.responsePath, "choices.0.message.content");
  assert.equal(values.headers, "X-Team: support");
  assert.ok(todo.some((t) => /second credential header \(x-api-key\)/.test(t)));
  // A nested message field is found breadth first, and nothing is invented when there is none.
  assert.deepEqual(templateFromBody({ options: { text: "x" }, question: "Hi", overrideConfig: { sessionId: "abc" } }), {
    template: { options: { text: "x" }, question: "{{input}}", overrideConfig: { sessionId: "{{conversation_id}}" } }, message: "question", conversation: "overrideConfig.sessionId",
  });
  assert.equal(templateFromBody({ a: 1 })?.message, null);
  assert.equal(templateFromBody([1, 2]), null);
  const placeholder = importCurl(`curl https://bot.example/chat -H 'Authorization: Bearer YOUR_API_KEY' -d '{"message":"hi"}'`) as Exclude<ReturnType<typeof importCurl>, { error: string }>;
  assert.ok(placeholder.todo.some((t) => /looks like a placeholder/.test(t)));
});

// ------------------------------------------------------------------ the inspector

test("the inspector shows what was sent without the credential, how the answer was read, and the fields to choose from", () => {
  const config: HttpAgentConfig = { kind: "http", url: "https://bot.example/chat?token=in-query", bodyTemplate: { message: "{{input}}" }, responsePath: "reply", authHeaderName: "authorization", headers: { "x-tenant": "acme" }, inlineChannels: true };
  const result: AgentResult = { ok: false, responseText: null, toolActivity: null, statusCode: 200, latencyMs: 120, raw: { data: { answer: "Hello! How can I help?" }, id: "x" }, wire: { contentType: "application/json", format: "json", matchedPath: "reply" }, error: 'No text found at response path "reply".' };
  const inspector = inspectPreflight(result, config, { message: "ping", conversationId: "c", credentialSent: true, notes: ["The credential was a bare token, so it is sent as “Authorization: Bearer …”."] });
  assert.equal(inspector.request.address, "https://bot.example/chat", "a query string can carry a token");
  assert.deepEqual(inspector.request.headers, ["content-type: application/json", "x-tenant: acme", "authorization: (your credential, not shown)"]);
  assert.deepEqual(JSON.parse(inspector.request.body), { message: "ping" });
  assert.equal(inspector.response.matchedPath, null);
  assert.deepEqual(inspector.fields.map((f) => f.path), ["data.answer", "id"]);
  assert.ok(inspector.notes.some((n) => /sent as a labelled block at the top of the message/.test(n)));
  assert.equal(JSON.stringify(inspector).includes("in-query"), false);

  assert.match(deliveryNotes({ url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" } }).join(" "), /conversation scenarios are not sent/);
  // A plain-text answer is offered as the whole reply; an HTML page is not.
  const text = classifyPreflight({ ok: false, responseText: null, toolActivity: null, statusCode: 200, latencyMs: 5, raw: "Hello there", error: "Agent response was not valid JSON" }, config);
  assert.equal(text.suggestedPath, "$text");
  const html = classifyPreflight({ ok: false, responseText: null, toolActivity: null, statusCode: 200, latencyMs: 5, raw: "<html>login</html>", error: "Agent response was not valid JSON" }, config);
  assert.equal(html.suggestedPath, undefined);
  const empty = classifyPreflight({ ok: false, responseText: null, toolActivity: null, statusCode: 200, latencyMs: 5, raw: { reply: "" }, emptyReply: true, error: "The agent answered with an empty reply." }, config);
  assert.match(empty.headline, /the reply was empty/);
});

// ------------------------------------------------------------------ one more attempt, and never a verdict

test("a request the agent's server failed is sent once more, only when sending it twice cannot act twice", async () => {
  const plain = { effect: undefined, destructive: undefined };
  assert.equal(worthOneMoreAttempt({ ok: false, statusCode: 500 }, plain), true);
  assert.equal(worthOneMoreAttempt({ ok: false, statusCode: 500 }, { effect: { type: "refund" } as never }), false, "it may already have acted");
  assert.equal(worthOneMoreAttempt({ ok: false, statusCode: 500 }, { destructive: true }), false);
  for (const status of [408, 429, 502, 503, 504]) assert.equal(worthOneMoreAttempt({ ok: false, statusCode: status }, plain), false, `${status} is an unreachable or rate-limiting endpoint, with its own rule`);
  assert.equal(worthOneMoreAttempt({ ok: false, statusCode: 400 }, plain), false);
  assert.equal(worthOneMoreAttempt({ ok: false, timedOut: true }, plain), false);
  assert.equal(worthOneMoreAttempt({ ok: false, error: "Request failed: ECONNRESET" }, plain), false);
  assert.equal(worthOneMoreAttempt({ ok: true }, plain), false);

  const fail500: AgentResult = { ok: false, responseText: null, toolActivity: null, statusCode: 500, latencyMs: 40, error: "Agent returned HTTP 500" };
  const good: AgentResult = { ok: true, responseText: "ok", toolActivity: null, statusCode: 200, latencyMs: 40 };
  assert.equal(afterSecondAttempt(fail500, good), good);
  assert.equal(afterSecondAttempt(fail500, fail500).error, "Agent returned HTTP 500 on two attempts 1.5 s apart.");
  assert.equal(afterSecondAttempt(fail500, { ...fail500, cutByNovera: true }), fail500, "a second attempt Novera cut short says nothing");

  // Twice the same: still no result, never a pass or a fail, and the cause says why it is neither.
  const sent: string[] = [];
  const t41 = scenario("T41");
  const outcome = await executeCase({ testCase: t41, agent: scripted(() => fail500, { context: false, conversation: false }, sent), policy: "p", judge: neverJudge, retryAfterMs: 0 });
  assert.equal(sent.length, 2);
  assert.equal(outcome.status, "error");
  assert.equal(outcome.settledBy, null);
  assert.equal(outcome.error, "Agent returned HTTP 500 on two attempts 1.5 s apart.");
  const repair = repairFor({ status: "error", error: outcome.error, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })!;
  assert.equal(repair.label, "Agent answered HTTP 500, twice");
  assert.match(repair.happened, /recorded as no result, not as a pass or a failure/);
  assert.equal(repair.retry, "safe");
  assert.deepEqual(scanCustomerLanguage(`${repair.happened} ${repair.next}`), []);

  // The second attempt answering is the result; nothing says there was a first.
  let n = 0;
  const recovering = scripted(() => (++n === 1 ? fail500 : { ...good, responseText: "The order number looks unusual. Could you confirm it?" }), { context: false, conversation: false });
  const recovered = await executeCase({ testCase: { ...t41, checks: [{ type: "must_not_contain", value: "confirm it" }] } as SuiteCase, agent: recovering, policy: "p", judge: neverJudge, retryAfterMs: 0 });
  assert.equal(recovered.status, "fail", "graded on the reply it gave, by the scenario's own rule");
  assert.equal(recovered.responseText, "The order number looks unusual. Could you confirm it?");
});

test("an HTTP 4xx on one scenario is no result with its cause said, never a pass", () => {
  for (const code of [400, 403, 422]) {
    const repair = repairFor({ status: "error", error: `Agent returned HTTP ${code}`, replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })!;
    assert.equal(repair.reason, "agent_http_error");
    assert.equal(repair.label, `Agent answered HTTP ${code}`);
  }
  const filtered = repairFor({ status: "error", error: "Agent returned HTTP 403", replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })!;
  assert.match(filtered.next, /firewall or content filter in front of the agent rejects this input on purpose/);
  const silent = repairFor({ status: "error", error: "The agent answered with an empty reply.", replied: false, evidenceGap: null, judgeAgreement: null, judgeAttempts: [], actsOnTheWorld: false, toolCalls: 0 })!;
  assert.equal(silent.label, "Agent answered with nothing");
});

test("the relay that answered in the agent's place no longer does", () => {
  const route = readFileSync("src/app/api/dify-adapter/route.ts", "utf8");
  const code = route.split("\n").filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
  assert.equal(/I am (NovaBot|an automated AI assistant)/.test(code), false, "no reply is invented for the agent");
  assert.match(code, /status: difyRes\.status/);
  assert.equal(/\.slice\(0, 4000\)/.test(code), false, "the scenario's text is sent whole");
});
