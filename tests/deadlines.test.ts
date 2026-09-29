import { test } from "node:test";
import assert from "node:assert/strict";
import { httpAgent, agentTimeoutMs, AGENT_TIMEOUT_MAX_MS } from "../src/lib/agents/http.ts";
import type { HttpAgentConfig } from "../src/lib/agents/types.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { openAiCompatibleProvider } from "../src/lib/providers/openai-compatible.ts";
import { ProviderError, retryAfterMs, type Provider } from "../src/lib/providers/types.ts";
import { caseNeedsMs, GRADING_RESERVE_MS } from "../src/lib/runner/execute.ts";
import { setResolverForTests } from "../src/lib/net/public-url.ts";
import type { SuiteCase } from "../src/lib/runner/types.ts";

setResolverForTests(async () => ["93.184.216.34"]);

const agentConfig: HttpAgentConfig = {
  kind: "http",
  url: "https://agent.example/chat",
  bodyTemplate: { message: "{{input}}" },
  responsePath: "reply",
};

/** A fetch that never answers until it is aborted, the way a hung server behaves. */
const hangingFetch = async (_url: unknown, init?: RequestInit) =>
  new Promise<Response>((_resolve, reject) => {
    init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
  });

test("an agent's timeout is its own setting, never more than 30 s", () => {
  assert.equal(agentTimeoutMs({}), AGENT_TIMEOUT_MAX_MS);
  assert.equal(agentTimeoutMs({ timeoutMs: 5_000 }), 5_000);
  assert.equal(agentTimeoutMs({ timeoutMs: 120_000 }), AGENT_TIMEOUT_MAX_MS);
});

test("an agent that runs out its own time is the agent's finding; one cut by the slice is not", async (t) => {
  t.mock.method(globalThis, "fetch", hangingFetch);

  const own = await httpAgent({ ...agentConfig, timeoutMs: 2_100 }).send({ input: "hi", policy: "" });
  assert.equal(own.timedOut, true);
  assert.equal(own.cutByNovera, undefined);
  assert.match(own.error ?? "", /did not answer within 2 s/);

  const cut = await httpAgent(agentConfig).send({ input: "hi", policy: "", deadline: Date.now() + 2_100 });
  assert.equal(cut.cutByNovera, true);
  assert.match(cut.error ?? "", /time slice was ending\. This says nothing about the agent/);
});

test("with too little time left, nothing is sent at all", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", hangingFetch);
  const result = await httpAgent(agentConfig).send({ input: "hi", policy: "", deadline: Date.now() + 500 });
  assert.equal(fetchMock.mock.callCount(), 0);
  assert.equal(result.cutByNovera, true);
  assert.match(result.error ?? "", /^Not sent/);
});

test("a redirect is answered, not followed", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/" } }));
  const result = await httpAgent(agentConfig).send({ input: "hi", policy: "" });
  assert.equal((fetchMock.mock.calls[0].arguments[1] as RequestInit).redirect, "manual");
  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /HTTP 302/);
});

test("a provider that hangs is abandoned and says it timed out", async (t) => {
  t.mock.method(globalThis, "fetch", hangingFetch);
  const provider = openAiCompatibleProvider("https://api.example/v1");
  await assert.rejects(
    () => provider.chat({ model: "m", messages: [{ role: "user", content: "x" }], timeoutMs: 50 }, "k"),
    (e: unknown) => e instanceof ProviderError && e.timedOut && /no answer within/.test(e.message),
  );
});

test("a 429's Retry-After is kept, in seconds or as a date", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    new Response(JSON.stringify({ error: { message: "slow down" } }), { status: 429, headers: { "retry-after": "7" } }));
  const provider = openAiCompatibleProvider("https://api.example/v1");
  await assert.rejects(
    () => provider.chat({ model: "m", messages: [{ role: "user", content: "x" }] }, "k"),
    (e: unknown) => e instanceof ProviderError && e.status === 429 && e.retryAfterMs === 7_000,
  );
  assert.equal(retryAfterMs(new Date(10_000).toUTCString(), 4_000), 6_000);
  assert.equal(retryAfterMs("soon"), undefined);
});

test("the router gives each grader what is left, and asks none once too little is", async () => {
  const seen: number[] = [];
  const slow: Provider = {
    id: "openai-compatible",
    label: "stub",
    async chat(request) {
      seen.push(request.timeoutMs ?? -1);
      throw new ProviderError("stub", "boom", 500);
    },
  } as Provider;
  const chat = createRoutedChat({
    connections: new Map([["a", { name: "a", provider: slow, apiKey: "k" }], ["b", { name: "b", provider: slow, apiKey: "k" }]]),
    routes: { judge: [{ connection: "a", model: "m1" }, { connection: "b", model: "m2" }] } as never,
  });

  await assert.rejects(() => chat("judge", { messages: [{ role: "user", content: "x" }] }, { deadline: Date.now() + 5_000, data: "public" }));
  assert.equal(seen.length, 2);
  assert.ok(seen.every((ms) => ms > 0 && ms <= 5_000), JSON.stringify(seen));

  seen.length = 0;
  await assert.rejects(
    () => chat("judge", { messages: [{ role: "user", content: "x" }] }, { deadline: Date.now() + 500, data: "public" }),
    (e: { attempts?: Array<{ error?: string }> }) => /time slice was ending/.test(e.attempts?.[0]?.error ?? ""),
  );
  assert.equal(seen.length, 0);
});

test("a case starts only with room for its turns at the agent's pace, plus grading", () => {
  const single = { id: "T1", input: "x" } as SuiteCase;
  const threeTurns = { id: "T2", input: "x", earlier_turns: ["a", "b"] } as SuiteCase;
  assert.equal(caseNeedsMs(single, 0), 6_000 + GRADING_RESERVE_MS);
  assert.equal(caseNeedsMs(single, 8_000), 16_000 + GRADING_RESERVE_MS);
  assert.equal(caseNeedsMs(single, 60_000), AGENT_TIMEOUT_MAX_MS + GRADING_RESERVE_MS);
  assert.equal(caseNeedsMs(threeTurns, 1_000), 3 * 6_000 + GRADING_RESERVE_MS);
});
