import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CircuitBreaker, createRoutedChat, describeAttempt, describeFailures, reasonFor, type RoutedAttempt,
} from "../src/lib/router/execute.ts";
import { ProviderError, type Provider } from "../src/lib/providers/types.ts";
import { judgeCase } from "../src/lib/judge/index.ts";
import { gradingNote } from "../src/app/(app)/runs/[id]/grading-note.ts";

test("a provider failure is classified by what it was, not by its words", () => {
  assert.equal(reasonFor(new ProviderError("p", "slow down", 429)), "rate_limited");
  assert.equal(reasonFor(new ProviderError("p", "no answer within 20 s", undefined, { timedOut: true })), "timed_out");
  assert.equal(reasonFor(new ProviderError("p", "bad key", 401)), "unauthorized");
  assert.equal(reasonFor(new ProviderError("p", "forbidden", 403)), "unauthorized");
  assert.equal(reasonFor(new ProviderError("p", "upstream", 503)), "provider_error");
  assert.equal(reasonFor(new Error("ECONNRESET")), "provider_error");
});

test("attempts are described in words a person can act on", () => {
  const a = (reason: RoutedAttempt["reason"], extra: Partial<RoutedAttempt> = {}): RoutedAttempt =>
    ({ connection: "groq", model: "m", ok: false, ms: 0, reason, ...extra });
  assert.equal(describeAttempt(a("rate_limited", { retryAfterMs: 6_200 })), "groq/m was rate-limited, asked to wait 7 s");
  assert.equal(describeAttempt(a("timed_out")), "groq/m did not answer in time");
  assert.equal(describeAttempt(a("provider_error", { error: "HTTP 503" })), "groq/m returned an error (HTTP 503)");
  assert.equal(describeAttempt(a(undefined, { error: "old row" })), "groq/m failed (old row)");
  assert.equal(describeFailures([a("timed_out"), { connection: "mistral", model: "x", ok: true, ms: 1 }]), "groq/m did not answer in time");
});

test("a breaker opens after two consecutive failures, or at once for a Retry-After, and closes on its own", () => {
  const b = new CircuitBreaker({ openMs: 1_000 });
  b.record("groq", { ok: false, reason: "timed_out" }, 0);
  assert.equal(b.isOpen("groq", 1), null);
  b.record("groq", { ok: false, reason: "provider_error" }, 2);
  assert.equal(b.isOpen("groq", 3), "provider_error");
  assert.equal(b.isOpen("groq", 1_003), null);

  b.record("mistral", { ok: false, reason: "rate_limited", retryAfterMs: 500 }, 0);
  assert.equal(b.isOpen("mistral", 100), "rate_limited");
  assert.equal(b.isOpen("mistral", 600), null);

  // A success in between resets the count; a refusal on our side never counts.
  b.record("x", { ok: false, reason: "timed_out" }, 0);
  b.record("x", { ok: true }, 1);
  b.record("x", { ok: false, reason: "timed_out" }, 2);
  assert.equal(b.isOpen("x", 3), null);
  b.record("y", { ok: false, reason: "refused_data_class" }, 0);
  b.record("y", { ok: false, reason: "refused_data_class" }, 1);
  assert.equal(b.isOpen("y", 2), null);
});

function provider(fn: () => Promise<string>): Provider {
  return {
    id: "openai-compatible",
    label: "stub",
    async chat() {
      return { text: await fn(), model: "m", usage: {}, raw: null };
    },
  } as Provider;
}

test("a vendor whose breaker is open is skipped with the reason, and the next one answers", async () => {
  let groqCalls = 0;
  const breaker = new CircuitBreaker();
  const chat = createRoutedChat({
    connections: new Map([
      ["groq", { name: "groq", provider: provider(async () => { groqCalls++; throw new ProviderError("groq", "limit", 429); }), apiKey: "k" }],
      ["mistral", { name: "mistral", provider: provider(async () => "fine"), apiKey: "k" }],
    ]),
    routes: { judge: [{ connection: "groq", model: "g" }, { connection: "mistral", model: "m" }] } as never,
    breaker,
  });
  const ask = () => chat("judge", { messages: [{ role: "user", content: "x" }] }, { data: "public" });

  await ask();
  await ask();
  const third = await ask();
  assert.equal(groqCalls, 2, "the third case does not wait on groq again");
  assert.equal(third.attempts[0].reason, "skipped_open_circuit");
  assert.match(third.attempts[0].error ?? "", /was rate-limited repeatedly/);
  assert.equal(third.servedBy.connection, "mistral");
});

test("a verdict that cannot be read is recorded as such on the attempt that produced it", async () => {
  const chat = createRoutedChat({
    connections: new Map([["mistral", { name: "mistral", provider: provider(async () => "I think it is fine?"), apiKey: "k" }]]),
    routes: { judge: [{ connection: "mistral", model: "m" }] } as never,
  });
  const outcome = await judgeCase({
    chat: (task, req, opts) => chat(task, req, { ...opts, data: "public" }),
    task: "judge",
    testCase: { id: "T1", input: "hi", expected_behavior: "greet", assertions: ["greets"] } as never,
    agentResponse: "hello",
  });
  assert.equal(outcome.status, "error");
  assert.equal(outcome.attempts.at(-1)?.reason, "invalid_output");
});

test("a grader that could not be reached says why in the case's note", () => {
  const note = gradingNote("groq/g", "unconfirmed", [
    { model: "groq/g", status: "pass" },
    { model: "none", status: "error", rationale: "No grader could answer: mistral/m did not answer in time." },
  ]);
  assert.equal(note, "graded by groq/g alone — no second model was reachable (mistral/m did not answer in time)");
  assert.equal(gradingNote("groq/g", "unconfirmed", [{ model: "groq/g", status: "pass" }]), "graded by groq/g alone — no second model was reachable");
});
