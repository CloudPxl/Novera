import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import {
  classifyPreflight, previewReply, topLevelKeys, PREFLIGHT_LIMIT, PREFLIGHT_MESSAGE, PREFLIGHT_OUTCOMES,
  PREFLIGHT_PREVIEW_CHARS, PREFLIGHT_TIMEOUT_MS, type PreflightResult,
} from "../src/lib/agents/preflight.ts";
import { httpAgent } from "../src/lib/agents/http.ts";
import type { AgentResult, HttpAgentConfig } from "../src/lib/agents/types.ts";
import { newHttpConfig, nextHttpConfig, parseConnectionEdit, parseEndpointFields } from "../src/lib/agents/connection.ts";
import {
  fixtureServed, isSampleAgent, SAMPLE_AGENT_NAME, SAMPLE_POLICY, SAMPLE_RUN_NOTE, sampleAgentConfig, sampleAgentDecision,
  sampleAttestation, sampleVerification,
} from "../src/lib/agents/sample.ts";
import { FIXTURE_ENVIRONMENT, isNoveraFixture, reportEnvironment } from "../src/lib/agents/environment.ts";
import { parseTestConnectionBody, preflightAnswer } from "../src/lib/api/test-connection.ts";
import { buildOpenApi } from "../src/lib/api/openapi.ts";
import { setResolverForTests } from "../src/lib/net/public-url.ts";
import { scanCustomerLanguage } from "../src/lib/report/language.ts";

/**
 * Block 6, module 1: "Test connection" before saving (a pure classifier over the run's own HTTP
 * adapter, nothing stored) and the sample support agent (Novera's fixture, labelled test data).
 */

const config = { responsePath: "reply" };
const res = (over: Partial<AgentResult>): AgentResult => ({ ok: false, responseText: null, toolActivity: null, latencyMs: 120, ...over });

// ---------------------------------------------------------------- classifier

test("success: status, round trip and the reply, cut at 200 characters", () => {
  const r = classifyPreflight(res({ ok: true, responseText: "Hi! How can I help?", statusCode: 200, latencyMs: 87, raw: { reply: "Hi! How can I help?" } }), config);
  assert.equal(r.outcome, "ok");
  assert.equal(r.ok, true);
  assert.equal(r.statusCode, 200);
  assert.equal(r.latencyMs, 87);
  assert.equal(r.replyPreview, "Hi! How can I help?");
  assert.equal(r.replyTruncated, false);
  assert.match(r.headline, /HTTP 200 in 87 ms/);

  const long = "word ".repeat(100);
  const cut = classifyPreflight(res({ ok: true, responseText: long, statusCode: 200, raw: { reply: long } }), config);
  assert.equal(cut.replyTruncated, true);
  assert.ok(Array.from(cut.replyPreview!).length <= PREFLIGHT_PREVIEW_CHARS + 1);
  assert.ok(cut.replyPreview!.endsWith("…"));
});

test("a preview never splits a surrogate pair and folds whitespace", () => {
  const emoji = "😀".repeat(250);
  const p = previewReply(emoji);
  assert.equal(p.truncated, true);
  assert.equal(Array.from(p.preview).length, PREFLIGHT_PREVIEW_CHARS + 1);
  assert.ok(!/[\ud800-\udbff]…$/.test(p.preview));
  assert.deepEqual(previewReply("a\n\n  b"), { preview: "a b", truncated: false });
});

test("401 and 403 say to check the header or token", () => {
  for (const status of [401, 403]) {
    const r = classifyPreflight(res({ statusCode: status, error: `Agent returned HTTP ${status}`, raw: { error: "nope" } }), config);
    assert.equal(r.outcome, "unauthorized");
    assert.equal(r.headline, `The endpoint returned HTTP ${status} — check the header or token`);
  }
});

test("other HTTP errors carry their status; a redirect is its own outcome", () => {
  const r = classifyPreflight(res({ statusCode: 503, error: "Agent returned HTTP 503", raw: "down" }), config);
  assert.equal(r.outcome, "http_error");
  assert.equal(r.statusCode, 503);
  assert.match(r.headline, /HTTP 503/);
  assert.equal(classifyPreflight(res({ statusCode: 404, error: "Agent returned HTTP 404" }), config).outcome, "http_error");
  assert.equal(classifyPreflight(res({ statusCode: 302, error: "Agent returned HTTP 302" }), config).outcome, "redirect");
});

// Audit 2026-10-17 (track 1): a 429 told the person to check the address and the request body.
test("a rate-limited or timed-out endpoint says so, and that a run records it as an error, never a failure", () => {
  const r = classifyPreflight(res({ statusCode: 429, error: "Agent returned HTTP 429", raw: { message: "Rate_Limited_By_WAF" } }), config);
  assert.equal(r.outcome, "http_error");
  assert.equal(r.statusCode, 429);
  assert.match(r.detail, /rate limiting/);
  assert.match(r.detail, /never as a failed scenario/);
  assert.doesNotMatch(r.detail, /request body/);
  assert.match(classifyPreflight(res({ statusCode: 408, error: "Agent returned HTTP 408" }), config).detail, /never as a failed scenario/);
});

test("timeout and network failures: could not reach the endpoint within 10 s", () => {
  const t = classifyPreflight(res({ timedOut: true, error: "The agent did not answer within 10 s." }), config);
  assert.equal(t.outcome, "timeout");
  assert.equal(t.headline, "Could not reach the endpoint within 10 s");
  const n = classifyPreflight(res({ error: "Request failed: fetch failed" }), config);
  assert.equal(n.outcome, "unreachable");
  assert.equal(n.headline, "Could not reach the endpoint within 10 s");
  const dns = classifyPreflight(res({ latencyMs: 0, error: "Not sent: bot.invalid could not be resolved." }), config);
  assert.equal(dns.outcome, "unreachable");
  assert.match(dns.detail, /could not be resolved/);
  assert.equal(PREFLIGHT_TIMEOUT_MS, 10_000);
});

test("a private address is refused and said to be not public", () => {
  const r = classifyPreflight(res({ latencyMs: 0, error: "Not sent: bot.internal points to a private or internal address (10.0.0.4). Novera calls only addresses on the public internet." }), config);
  assert.equal(r.outcome, "refused_address");
  assert.match(r.headline, /not a public address/);
  assert.equal(r.statusCode, null);
  assert.equal(r.latencyMs, null);
});

test("200 without a reply at the path: top-level keys only, never values, and a suggestion", () => {
  const raw = { output: { text: "Hello there, how can I help you today with your account?" }, secret_token: "sk-live-123", id: "abc" };
  const r = classifyPreflight(res({ statusCode: 200, error: 'No text found at response path "reply".', raw }), config);
  assert.equal(r.outcome, "no_reply_at_path");
  assert.deepEqual(r.topLevelKeys, ["output", "secret_token", "id"]);
  assert.equal(r.suggestedPath, "output.text");
  const json = JSON.stringify(r);
  assert.ok(!json.includes("sk-live-123") && !json.includes("Hello there"), "no value of the reply reaches the result");
  assert.equal(r.replyPreview, undefined);

  const arr = classifyPreflight(res({ statusCode: 200, error: "x", raw: [{ text: "hi" }] }), config);
  assert.deepEqual(arr.topLevelKeys, []);
  assert.match(arr.detail, /JSON array/);
  assert.deepEqual(topLevelKeys({ a: 1, b: { c: 2 } }), ["a", "b"]);
  assert.equal(classifyPreflight(res({ statusCode: 200, error: "Agent response was not valid JSON", raw: "<html>" }), config).outcome, "not_json");
  assert.equal(classifyPreflight(res({ statusCode: 200, error: "The agent's reply was larger than 256 KB, so Novera stopped reading it." }), config).outcome, "too_large");
});

test("every outcome code is stable and the API answer carries no credential field", () => {
  assert.deepEqual([...PREFLIGHT_OUTCOMES], ["ok", "timeout", "unreachable", "refused_address", "unauthorized", "http_error", "redirect", "too_large", "not_json", "no_reply_at_path"]);
  const answer = preflightAnswer(classifyPreflight(res({ ok: true, responseText: "hi", statusCode: 200, raw: { reply: "hi" } }), config));
  assert.equal(answer.outcome, "ok");
  assert.equal(answer.stored, false);
  assert.equal(answer.reply_preview, "hi");
  assert.ok(!("auth_value" in answer) && !("credential" in answer));
  assert.deepEqual(PREFLIGHT_LIMIT, { max: 20, windowSeconds: 600 });
});

// ---------------------------------------------------------------- through the real adapter

let server: Server;
let origin = "";
let lastAuth: string | undefined;
let lastBody = "";
const servers: Server[] = [];
after(() => { for (const s of servers) { s.closeAllConnections(); s.close(); } setResolverForTests(null); });

async function listen(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const s = createServer(handler);
  servers.push(s);
  await new Promise<void>((r) => s.listen(0, "127.0.0.1", r));
  return `http://127.0.0.1:${(s.address() as AddressInfo).port}`;
}

test("the test sends the diagnostic message with the form's template and header, through the run's adapter", async () => {
  origin = await listen((req, reply) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      lastAuth = req.headers["x-api-key"] as string | undefined;
      lastBody = body;
      const path = req.url ?? "/";
      if (path === "/locked" && lastAuth !== "right") { reply.writeHead(401, { "content-type": "application/json" }); reply.end('{"error":"unauthorised"}'); return; }
      if (path === "/broken") { reply.writeHead(500); reply.end("boom"); return; }
      if (path === "/shape") { reply.writeHead(200, { "content-type": "application/json" }); reply.end('{"data":{"answer":"Hello from the shape endpoint, how can I help?"},"meta":"x"}'); return; }
      if (path === "/slow") return; // never answers
      reply.writeHead(200, { "content-type": "application/json" });
      reply.end(JSON.stringify({ reply: `Echo: ${JSON.parse(body).q}` }));
    });
  });
  server = servers[0];
  void server;

  const fields = parseEndpointFields({ url: `${origin}/ok`, bodyTemplate: '{"q":"{{input}}"}', responsePath: "reply", toolActivityPath: "", authHeaderName: "x-api-key" });
  assert.ok(fields.ok);
  const cfg = newHttpConfig(fields.value);
  const result = await httpAgent({ ...cfg, timeoutMs: PREFLIGHT_TIMEOUT_MS }, "secret-value").send({ input: PREFLIGHT_MESSAGE, policy: "" });
  const r = classifyPreflight(result, cfg);
  assert.equal(r.outcome, "ok");
  assert.equal(r.replyPreview, `Echo: ${PREFLIGHT_MESSAGE}`);
  assert.equal(lastAuth, "secret-value");
  assert.ok(lastBody.includes("connection check from Novera"));
  assert.ok(!JSON.stringify(r).includes("secret-value"), "the credential never reaches the result");

  const send = async (path: string, over: Partial<HttpAgentConfig> = {}, credential?: string): Promise<PreflightResult> => {
    const c: HttpAgentConfig = { ...cfg, url: `${origin}${path}`, ...over };
    return classifyPreflight(await httpAgent({ ...c, timeoutMs: over.timeoutMs ?? PREFLIGHT_TIMEOUT_MS }, credential).send({ input: PREFLIGHT_MESSAGE, policy: "" }), c, over.timeoutMs ?? PREFLIGHT_TIMEOUT_MS);
  };
  assert.equal((await send("/locked", {}, "wrong")).outcome, "unauthorized");
  assert.equal((await send("/locked", {}, "right")).outcome, "ok");
  const broken = await send("/broken");
  assert.equal(broken.outcome, "http_error");
  assert.equal(broken.statusCode, 500);
  const shape = await send("/shape");
  assert.equal(shape.outcome, "no_reply_at_path");
  assert.deepEqual(shape.topLevelKeys, ["data", "meta"]);
  assert.equal(shape.suggestedPath, "data.answer");
  const slow = await send("/slow", { timeoutMs: 2_000 });
  assert.equal(slow.outcome, "timeout");
  assert.equal(slow.headline, "Could not reach the endpoint within 2 s");
});

test("an address that resolves privately is refused before anything is sent", async () => {
  setResolverForTests(async () => ["10.0.0.7"]);
  try {
    const c: HttpAgentConfig = { kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply" };
    const r = classifyPreflight(await httpAgent({ ...c, timeoutMs: PREFLIGHT_TIMEOUT_MS }).send({ input: PREFLIGHT_MESSAGE, policy: "" }), c);
    assert.equal(r.outcome, "refused_address");
  } finally {
    setResolverForTests(null);
  }
});

// ---------------------------------------------------------------- the edit form's credential rule

const form = (over: Record<string, unknown> = {}) => ({
  name: "Support bot", url: "https://bot.example/chat", bodyTemplate: '{"message":"{{input}}"}', responsePath: "reply",
  toolActivityPath: "", timeoutSeconds: "", authHeaderName: "authorization", credential: "", removeCredential: null, ...over,
});

test("on edit, an empty credential means the stored one only while the host is unchanged", () => {
  const same = parseConnectionEdit(form({ url: "https://bot.example/v2/chat" }), true, "https://bot.example/chat");
  assert.ok(same.ok);
  assert.equal(same.value.credential, "keep");

  const moved = parseConnectionEdit(form({ url: "https://elsewhere.example/chat" }), true, "https://bot.example/chat");
  assert.equal(moved.ok, false);
  assert.match((moved as { error: string }).error, /different host/);

  const pasted = parseConnectionEdit(form({ url: "https://elsewhere.example/chat", credential: "Bearer new" }), true, "https://bot.example/chat");
  assert.ok(pasted.ok);
  assert.equal(pasted.value.credential, "replace");

  const removed = parseConnectionEdit(form({ url: "https://elsewhere.example/chat", removeCredential: "on" }), true, "https://bot.example/chat");
  assert.ok(removed.ok);
  assert.equal(removed.value.credential, "remove");
  const current: HttpAgentConfig = { kind: "http", url: "https://bot.example/chat", bodyTemplate: { message: "{{input}}" }, responsePath: "reply", authHeaderName: "authorization" };
  assert.equal(nextHttpConfig(current, removed.value).authHeaderName, undefined, "a removed credential leaves no header to fill");
});

test("connect, edit and test read the endpoint fields the same way", () => {
  const bad = parseEndpointFields({ url: "https://bot.example", bodyTemplate: '{"m":"{{message}}"}', responsePath: "reply", toolActivityPath: "", authHeaderName: "" });
  assert.equal(bad.ok, false);
  const edit = parseConnectionEdit(form({ bodyTemplate: '{"m":"{{message}}"}' }), false);
  assert.equal(edit.ok, false);
  assert.equal((bad as { error: string }).error, (edit as { error: string }).error);
  assert.equal(parseEndpointFields({ url: "https://u:p@bot.example", bodyTemplate: "", responsePath: "reply", toolActivityPath: "", authHeaderName: "" }).ok, false);
  assert.equal(parseEndpointFields({ url: "https://bot.example", bodyTemplate: "", responsePath: "reply", toolActivityPath: "", authHeaderName: "content-type" }).ok, false);
});

// ---------------------------------------------------------------- the API body

test("the API takes the connection's fields or an agent id, never both", () => {
  const f = parseTestConnectionBody({ url: "https://bot.example", body_template: { q: "{{input}}" }, auth_header_name: "x-api-key", auth_value: "k" });
  assert.ok(!("error" in f) && f.kind === "fields");
  assert.equal(f.fields.bodyTemplate, '{"q":"{{input}}"}');
  assert.equal(f.fields.responsePath, "reply");
  const a = parseTestConnectionBody({ agent_id: "8f9c7f0e-1d2b-4c3a-9e8f-0a1b2c3d4e5f" });
  assert.ok(!("error" in a) && a.kind === "agent");
  assert.ok("error" in parseTestConnectionBody({ agent_id: "8f9c7f0e-1d2b-4c3a-9e8f-0a1b2c3d4e5f", url: "https://x.example" }));
  assert.ok("error" in parseTestConnectionBody({ agent_id: "nope" }));
  assert.ok("error" in parseTestConnectionBody([]));
  assert.ok("error" in parseTestConnectionBody({ url: 5 }));
});

test("the endpoint is documented with its outcomes and the write scope", () => {
  const doc = buildOpenApi() as unknown as { paths: Record<string, { post?: { description: string; responses: Record<string, unknown> } }>; components: { schemas: Record<string, { properties: { outcome: { enum: string[] } } }> } };
  const op = doc.paths["/api/v1/agents/test-connection"]?.post;
  assert.ok(op);
  assert.match(op.description, /`write` scope/);
  assert.deepEqual(doc.components.schemas.ConnectionTest.properties.outcome.enum, [...PREFLIGHT_OUTCOMES]);
});

// ---------------------------------------------------------------- the sample agent

test("the sample agent points at this deployment's fixture, with its read-back, and reads as test data", () => {
  const cfg = sampleAgentConfig("http://localhost:3100/");
  assert.equal(cfg.url, "http://localhost:3100/api/test-agent");
  assert.deepEqual(cfg.bodyTemplate, { message: "{{input}}", context: "{{context}}", history: "{{history}}" });
  assert.equal(cfg.responsePath, "reply");
  assert.equal(cfg.toolActivityPath, "tool_calls");
  assert.deepEqual(sampleVerification("http://localhost:3100"), { kind: "http_read", url: "http://localhost:3100/api/test-verification/" });
  assert.equal(isNoveraFixture(cfg), true);
  assert.equal(reportEnvironment(cfg), FIXTURE_ENVIRONMENT);
  assert.match(reportEnvironment(cfg), /fixture/i, "the report page labels an environment naming a fixture as test data");
  assert.equal(isNoveraFixture(sampleAgentConfig("https://www.nover.space")), true);
  assert.equal(isNoveraFixture(sampleAgentConfig("https://preview.example"), "https://preview.example"), true);
  assert.equal(SAMPLE_AGENT_NAME, "Sample support agent (Novera test fixture)");
  assert.match(sampleAttestation("ops@example.com", "2026-10-16"), /^ops@example\.com added Novera's sample support agent on 2026-10-16\. .*test data/);
  assert.match(SAMPLE_POLICY, /Sample policy for Novera's test fixture/);
  assert.match(SAMPLE_RUN_NOTE, /one of your three/);
});

test("a second press reuses the sample; an archived one or a look-alike does not count", () => {
  const sample = { id: "a1", name: SAMPLE_AGENT_NAME, config: sampleAgentConfig("http://localhost:3100"), archived_at: null };
  assert.deepEqual(sampleAgentDecision([]), { action: "create" });
  assert.deepEqual(sampleAgentDecision([sample]), { action: "reuse", agentId: "a1" });
  assert.deepEqual(sampleAgentDecision([{ ...sample, archived_at: "2026-10-01T00:00:00Z" }]), { action: "create" });
  const lookalike = { ...sample, id: "a2", config: { ...sample.config, url: "https://customer.example/api/test-agent" } };
  assert.equal(isSampleAgent(lookalike), false, "the name alone is not the sample");
  assert.deepEqual(sampleAgentDecision([lookalike]), { action: "create" });
  assert.deepEqual(sampleAgentDecision([{ ...sample, name: "My bot" }]), { action: "create" });
});

test("the fixture answers outside development only when the deployment turns the sample on", () => {
  assert.equal(fixtureServed({ NODE_ENV: "development" }), true);
  assert.equal(fixtureServed({ NODE_ENV: "test" }), true);
  assert.equal(fixtureServed({ NODE_ENV: "production" }), true, "on by default since 2026-10-16");
  assert.equal(fixtureServed({ NODE_ENV: "production", NOVERA_SAMPLE_AGENT: "off" }), false);
  assert.equal(fixtureServed({ NODE_ENV: "development", NOVERA_SAMPLE_AGENT: "off" }), false);
  for (const route of ["src/app/api/test-agent/route.ts", "src/app/api/test-verification/[...path]/route.ts"]) {
    assert.match(readFileSync(route, "utf8"), /if \(!fixtureServed\(\)\)/, `${route} answers only where the fixture is served`);
  }
});

// ---------------------------------------------------------------- the language rule

test("every new sentence keeps to the language rule", () => {
  const results = [
    classifyPreflight(res({ ok: true, responseText: "hi", statusCode: 200, raw: { reply: "hi" } }), config),
    classifyPreflight(res({ timedOut: true }), config),
    classifyPreflight(res({ timedOut: true, statusCode: 200 }), config),
    classifyPreflight(res({ error: "Request failed" }), config),
    classifyPreflight(res({ error: "Not sent: x could not be resolved." }), config),
    classifyPreflight(res({ error: "Not sent: x points to a private or internal address (10.0.0.1)." }), config),
    classifyPreflight(res({ statusCode: 401 }), config),
    classifyPreflight(res({ statusCode: 301 }), config),
    classifyPreflight(res({ statusCode: 500 }), config),
    classifyPreflight(res({ statusCode: 422 }), config),
    classifyPreflight(res({ statusCode: 200, error: "larger than 256 KB" }), config),
    classifyPreflight(res({ statusCode: 200, raw: "x" }), config),
    classifyPreflight(res({ statusCode: 200, raw: { a: 1 } }), config),
    classifyPreflight(res({ statusCode: 200, raw: [] }), config),
    classifyPreflight(res({ statusCode: 200, raw: {} }), config),
  ];
  const sentences = [
    ...results.flatMap((r) => [r.headline, r.detail]),
    SAMPLE_AGENT_NAME, SAMPLE_POLICY, SAMPLE_RUN_NOTE, sampleAttestation("a@b.example", "2026-10-16"), PREFLIGHT_MESSAGE,
    ...["src/app/(app)/agents/connection-test.tsx", "src/app/(app)/agents/sample-agent.tsx", "src/lib/workflow/connection-actions.ts",
      "src/lib/workflow/preflight.ts", "src/app/api/v1/agents/test-connection/route.ts", "data/docs/connecting-an-agent.md", "data/docs/api.md"]
      .map((p) => readFileSync(p, "utf8")),
  ];
  for (const text of sentences) assert.deepEqual(scanCustomerLanguage(text), [], text.slice(0, 120));
});

test("the fixture refuses a body over 64 KB before reading it, and answers a normal one", async () => {
  const { POST } = await import("../src/app/api/test-agent/route.ts");
  const big = JSON.stringify({ message: "x".repeat(70 * 1024) });
  const declared = await POST(new Request("http://localhost/api/test-agent", { method: "POST", body: big, headers: { "content-type": "application/json", "content-length": String(big.length) } }));
  assert.equal(declared.status, 413);
  const undeclared = await POST(new Request("http://localhost/api/test-agent", { method: "POST", body: big, headers: { "content-type": "application/json" } }));
  assert.equal(undeclared.status, 413);
  const ok = await POST(new Request("http://localhost/api/test-agent", { method: "POST", body: JSON.stringify({ message: "Hello" }), headers: { "content-type": "application/json" } }));
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { fixture?: boolean }).fixture, true);
});

test("one sample agent per workspace however many clicks race: the database refuses the second, the action opens the first", () => {
  const sql = readFileSync("supabase/migrations/0073_one_sample_agent.sql", "utf8");
  assert.match(sql, /create unique index if not exists agents_one_sample_per_workspace\s+on agents \(workspace_id\)/);
  assert.ok(sql.includes(`name = '${SAMPLE_AGENT_NAME}'`), "the index names the sample exactly as the action does");
  assert.match(sql, /\(config ->> 'url'\) like '%\/api\/test-agent'/, "only the fixture's address, never a customer's agent of the same name");
  assert.match(sql, /set archived_at = now\(\), archived_by = a\.attested_by/, "existing duplicates are archived, never deleted");
  const action = readFileSync("src/lib/workflow/connection-actions.ts", "utf8");
  assert.match(action, /error\?\.code === "23505"[\s\S]{0,900}redirect\(`\/agents\/\$\{raced\.agentId\}`\)/);
});
