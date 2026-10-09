import { test } from "node:test";
import assert from "node:assert/strict";
import { scrubEvent, scrubText, scrubPath, scrubHeaders, scrubDetail, MESSAGE_LIMIT } from "../src/lib/observability/scrub.ts";
import { parseSentryDsn, sentryEnvelope } from "../src/lib/observability/reporter.ts";
import { captureError, configuredReporters } from "../src/lib/observability/capture.ts";
import { syntheticFailure, leakedFragments } from "../src/lib/observability/test-event.ts";

test("the synthetic failure leaks nothing: keys, bearer, JWT, email, report token, cookie, policy, agent reply", () => {
  const { error, request, context } = syntheticFailure();
  const event = scrubEvent({ error, request, context, environment: "test" });
  const serialised = JSON.stringify(event);
  assert.deepEqual(leakedFragments(serialised), []);
  // And it is still useful: what failed, where.
  assert.equal(event.name, "Error");
  assert.match(event.message, /^Provider refused key/);
  assert.match(event.message, /Failing row contains \[ROW\]/);
  assert.equal(event.request?.path, "/report/[token]");
  assert.equal(event.request?.method, "GET");
  assert.deepEqual(event.request?.headers, { accept: "text/html" });
  assert.equal(event.request?.droppedHeaders, 4);
  assert.equal(event.context?.routePath, "/report/[token]");
  assert.ok(event.stack && event.stack.every((f) => f.startsWith("at ")), "stack frames only, never the message line");
});

test("the unscrubbed failure does contain them, so the test above is not vacuous", () => {
  const { error, request } = syntheticFailure();
  const raw = JSON.stringify({ message: error.message, request });
  assert.equal(leakedFragments(raw).length, 12);
});

test("report and invitation tokens are removed from any path, with the query", () => {
  assert.equal(scrubPath("/report/AbC_dEf-123?x=1"), "/report/[token]");
  assert.equal(scrubPath("/api/reports/AbC_dEf-123/export?format=pdf"), "/api/reports/[token]/export");
  assert.equal(scrubPath("/invite/zzzTOKENzzz"), "/invite/[token]");
  assert.equal(scrubPath("/runs/7d3c0c1e-1111-4222-8333-944455556666"), "/runs/7d3c0c1e-1111-4222-8333-944455556666");
});

test("query strings and one-time codes in URLs are dropped", () => {
  assert.equal(scrubText("redirect to https://www.nover.space/auth/callback?code=abc123&flow=signup failed"),
    "redirect to https://www.nover.space/auth/callback?[QUERY] failed");
  assert.equal(scrubText("token_hash=abcdef1234 and code=zzz"), "token_hash=[REDACTED] and code=[REDACTED]");
});

test("database refusals lose the row and the duplicate value, keep the constraint", () => {
  assert.equal(
    scrubText(`duplicate key value violates unique constraint "x" Key (email)=(a@b.eu) already exists.`),
    `duplicate key value violates unique constraint "x" Key (email)=([VALUE]) already exists.`,
  );
  assert.equal(scrubText("violates check constraint \"c\" Failing row contains (1, secret policy text, 2)."), "violates check constraint \"c\" Failing row contains [ROW].");
});

test("cookies and auth headers written into a message are redacted", () => {
  const out = scrubText("cookie: sb-proj-auth-token=base64-eyJhY2Nlc3NfdG9rZW4iOiJ4In0aaaaaaaa; other=1");
  assert.ok(!/eyJhY2Nlc3N/.test(out));
  assert.match(scrubText("authorization=Basic dXNlcjpwYXNz"), /authorization: \[REDACTED\]/);
});

test("only harmless headers are kept; everything else is counted", () => {
  const { headers, dropped } = scrubHeaders({ Cookie: "a=b", Authorization: "Bearer x", "Content-Type": "application/json", "next-action": "7f00aa", "x-forwarded-for": "1.2.3.4" });
  assert.deepEqual(headers, { "content-type": "application/json", "next-action": "[present]" });
  assert.equal(dropped, 3);
});

test("caller detail keeps short enum-like values under non-content keys only", () => {
  assert.deepEqual(scrubDetail({ stage: "seal", cases: 36, retried: true, policy_body: "x", reply: "hi", note: "two words", key: "nvk_x" }), { stage: "seal", cases: 36, retried: true });
  assert.equal(scrubDetail({ body: "x" }), undefined);
});

test("a long message is truncated; a non-Error throw is described, not serialised", () => {
  const event = scrubEvent({ error: new Error("a ".repeat(2000)) });
  assert.ok(event.message.length <= MESSAGE_LIMIT + 20);
  const odd = scrubEvent({ error: { secret: "sk-live-abcdef1234567890", digest: "123" } });
  assert.equal(odd.message, "A non-Error value was thrown.");
  assert.equal(odd.digest, "123");
  assert.ok(!JSON.stringify(odd).includes("abcdef1234567890"));
});

test("an error's other properties never reach the event", () => {
  const error = Object.assign(new Error("boom"), { cause: new Error("policy text here"), config: { headers: { authorization: "Bearer zzzzzzzzzzzzzzzz" } } });
  const serialised = JSON.stringify(scrubEvent({ error }));
  assert.ok(!serialised.includes("policy text here"));
  assert.ok(!serialised.includes("zzzzzzzzzzzzzzzz"));
});

test("vendors are off by default; each needs its own variable; off means nothing at all", () => {
  assert.deepEqual(configuredReporters({}).vendors, []);
  assert.equal(configuredReporters({}).console, true);
  assert.deepEqual(configuredReporters({ NOVERA_ERROR_REPORTING: "off", NOVERA_ERROR_WEBHOOK_URL: "https://x.example" }), { console: false, vendors: [], problems: [] });
  assert.deepEqual(configuredReporters({ NOVERA_ERROR_SENTRY_DSN: "https://pub@o1.ingest.de.sentry.io/42" }).vendors.map((v) => v.name), ["sentry"]);
  assert.deepEqual(configuredReporters({ NOVERA_ERROR_WEBHOOK_URL: "http://example.com/hook", NODE_ENV: "production" }).problems.length, 1);
  assert.equal(configuredReporters({ NOVERA_ERROR_SENTRY_DSN: "not a dsn" }).problems.length, 1);
});

test("a Sentry DSN becomes its envelope endpoint; the envelope carries only the scrubbed event", () => {
  assert.deepEqual(parseSentryDsn("https://pub@o1.ingest.de.sentry.io/42"), { endpoint: "https://o1.ingest.de.sentry.io/api/42/envelope/", publicKey: "pub" });
  assert.equal(parseSentryDsn("http://pub@host/42"), null);
  const { error, request, context } = syntheticFailure();
  const envelope = sentryEnvelope(scrubEvent({ error, request, context, environment: "test" }), "https://pub@o1.ingest.de.sentry.io/42");
  const lines = envelope.split("\n");
  assert.equal(lines.length, 3);
  assert.equal(JSON.parse(lines[1]).type, "event");
  assert.deepEqual(leakedFragments(envelope), []);
  assert.ok(!/"user"|server_name/.test(envelope));
});

test("captureError never throws and prints one scrubbed console line", async () => {
  const lines: string[] = [];
  const original = console.error;
  console.error = (line: string) => { lines.push(line); };
  try {
    const { error, request, context } = syntheticFailure();
    const event = await captureError(error, { request, context });
    assert.ok(event);
    assert.equal(lines.length, 1);
    assert.match(lines[0], /^\[novera:error\] \{/);
    assert.deepEqual(leakedFragments(lines[0]), []);
    // A value whose getters throw is still reported, never rethrown.
    const hostile = new Proxy({}, { get() { throw new Error("no"); }, has() { throw new Error("no"); } });
    await captureError(hostile);
  } finally {
    console.error = original;
  }
});
