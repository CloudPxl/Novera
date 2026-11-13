import test from "node:test";
import assert from "node:assert/strict";
import { createRoutedChat, Pacer, SharedPacer } from "../src/lib/router/execute.ts";
import { KeyCooldowns, keyId, KEY_COOLDOWN_DEFAULT_MS } from "../src/lib/router/key-pool.ts";
import { keyPool, connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { ProviderError, type Provider } from "../src/lib/providers/types.ts";

/** A provider whose answer depends on the key and model it was asked with. */
function keyed(answer: (key: string, model: string) => string | ProviderError, log: string[]): Provider {
  return {
    id: "openai-compatible", label: "stub",
    async chat(request: { model: string }, key: string) {
      log.push(`${key}/${request.model}`);
      const out = answer(key, request.model);
      if (out instanceof ProviderError) throw out;
      return { text: '{"verdict":"pass","rationale":"ok","failed_assertions":[]}', model: request.model, usage: {}, raw: null };
    },
  } as unknown as Provider;
}

const limited = (retryAfterMs?: number) => {
  const e = new ProviderError("groq", "rate limit reached for tokens per minute", 429);
  if (retryAfterMs !== undefined) (e as { retryAfterMs?: number }).retryAfterMs = retryAfterMs;
  return e;
};
const ask = (chat: ReturnType<typeof createRoutedChat>) =>
  chat("judge", { messages: [{ role: "user", content: "x" }] }, { data: "public" });

test("a key pool is read from <NAME>_API_KEYS, then _API_KEY and _API_KEY_FALLBACK, cleaned and without duplicates", () => {
  assert.deepEqual(keyPool({ GROQ_API_KEYS: " a , b ,a,, ", GROQ_API_KEY: "c", GROQ_API_KEY_FALLBACK: "b" }, "GROQ"), ["a", "b", "c"]);
  assert.deepEqual(keyPool({ GROQ_API_KEY: "only" }, "GROQ"), ["only"]);
  assert.deepEqual(keyPool({}, "GROQ"), []);
  assert.equal(keyPool({ GROQ_API_KEYS: Array.from({ length: 12 }, (_, i) => `k${i}`).join(",") }, "GROQ").length, 8);
  const groq = connectionsFromEnv({ GROQ_API_KEYS: "a,b,c" } as never).get("groq");
  assert.deepEqual(groq?.apiKeys, ["a", "b", "c"]);
  assert.equal(groq?.apiKey, "a");
  assert.equal(groq?.fallbackApiKey, "b", "the second key stays the fallback for code that reads one");
  assert.deepEqual(connectionsFromEnv({ GEMINI_API_KEY: "g1", GEMINI_API_KEY_FALLBACK: "g2" } as never).get("gemini")?.apiKeys, ["g1", "g2"]);
  assert.equal(keyId("secret-key").length, 16);
  assert.ok(!keyId("secret-key").includes("secret"));
});

test("a 429 moves to the next key at once, and the limited key is not asked again for that model while it cools", async () => {
  const log: string[] = [];
  const cooldowns = new KeyCooldowns();
  const chat = createRoutedChat({
    connections: new Map([["groq", { name: "groq", provider: keyed((k) => (k === "k1" ? limited(30_000) : "ok"), log), apiKey: "k1", apiKeys: ["k1", "k2"] }]]),
    routes: { judge: [{ connection: "groq", model: "g" }] } as never,
    cooldowns,
  });
  const began = Date.now();
  const first = await ask(chat);
  assert.ok(Date.now() - began < 500, "no wait between the two keys");
  assert.deepEqual(log, ["k1/g", "k2/g"]);
  assert.match(first.attempts[0].error ?? "", /next key/);
  assert.equal(first.attempts.at(-1)?.ok, true);
  assert.ok(!JSON.stringify(first.attempts).includes("k1"), "no key in what is stored");
  log.length = 0;
  await ask(chat);
  assert.deepEqual(log, ["k2/g"], "the cooling key is skipped without a call");
  assert.ok(cooldowns.coolingFor("k1", "g") > 25_000);
  assert.equal(cooldowns.coolingFor("k1", "other"), 0, "a limit is per model");
});

test("when every key is at its limit the next vendor is asked at once, and later cases skip the limited vendor without a call", async () => {
  const log: string[] = [];
  const cooldowns = new KeyCooldowns();
  const chat = createRoutedChat({
    connections: new Map([
      ["groq", { name: "groq", provider: keyed(() => limited(45_000), log), apiKey: "k1", apiKeys: ["k1", "k2"] }],
      ["mistral", { name: "mistral", provider: keyed(() => "ok", log), apiKey: "m1" }],
    ]),
    routes: { judge: [{ connection: "groq", model: "g" }, { connection: "mistral", model: "m" }] } as never,
    cooldowns,
  });
  const began = Date.now();
  const first = await ask(chat);
  assert.ok(Date.now() - began < 500, "a 45 s Retry-After is never slept on");
  assert.equal(first.servedBy.connection, "mistral");
  assert.deepEqual(log, ["k1/g", "k2/g", "m1/m"]);
  log.length = 0;
  const second = await ask(chat);
  assert.deepEqual(log, ["m1/m"]);
  assert.equal(second.attempts[0].reason, "rate_limited");
  assert.match(second.attempts[0].error ?? "", /^not asked: every groq key was rate-limited for this model/);
  assert.ok((second.attempts[0].retryAfterMs ?? 0) > 40_000);
});

test("a refused key cools for every model; a key that answers is cleared; one store is shared by the routers given it", async () => {
  const log: string[] = [];
  const cooldowns = new KeyCooldowns();
  const conn = (answer: (k: string, m: string) => string | ProviderError) =>
    new Map([["groq", { name: "groq", provider: keyed(answer, log), apiKey: "k1", apiKeys: ["k1", "k2"] }]]);
  const a = createRoutedChat({
    connections: conn((k) => (k === "k1" ? new ProviderError("groq", "invalid key", 401) : "ok")),
    routes: { judge: [{ connection: "groq", model: "g" }] } as never,
    cooldowns,
  });
  await ask(a);
  assert.ok(cooldowns.coolingFor("k1", "anything") > 60_000);
  log.length = 0;
  const b = createRoutedChat({ connections: conn(() => "ok"), routes: { judge: [{ connection: "groq", model: "h" }] } as never, cooldowns });
  await ask(b);
  assert.deepEqual(log, ["k2/h"], "another router sharing the store skips the refused key");

  const c = new KeyCooldowns();
  c.limited("x", "g", undefined, 0);
  assert.equal(c.coolingFor("x", "g", 0), KEY_COOLDOWN_DEFAULT_MS, "no Retry-After cools for the default");
  c.answered("x", "g");
  assert.equal(c.coolingFor("x", "g", 0), 0);
  c.limited("y", "g", 600_000, 0);
  assert.equal(c.coolingFor("y", "g", 0), 60_000, "never longer than a minute");
});

test("the shared pacer reserves through the database, divides the interval by the keys, and paces locally when the function is missing", async () => {
  SharedPacer.resetForTests();
  const calls: Array<Record<string, unknown>> = [];
  let answer: unknown = 1_500;
  const pacer = new SharedPacer(async (args) => {
    calls.push(args);
    return answer instanceof Error ? { data: null, error: { message: answer.message } } : { data: answer, error: null };
  }, { groq: 8_000 });
  const groq = { connection: "groq", model: "g" };
  assert.equal(await pacer.reserve(groq, 20_000, 2), 1_500);
  assert.deepEqual(calls[0], { slot_key: "groq/g", interval_ms: 4_000, max_wait_ms: 20_000 });
  answer = -1;
  assert.equal(await pacer.reserve(groq, 20_000), null, "a slot further than the caller can wait is refused");
  assert.equal(await pacer.reserve({ connection: "gemini", model: "x" }, 20_000), 0, "an unpaced connection never asks the database");
  assert.equal(calls.length, 2);
  answer = new Error("Could not find the function public.reserve_model_slot");
  assert.equal(await pacer.reserve(groq, 20_000), 0, "falls back to its own pacing: the first slot is now");
  assert.equal(await pacer.reserve(groq, 20_000), 8_000, "and paces on its own after that");
  assert.equal(calls.length, 3, "the missing function is not asked again for a while");
  SharedPacer.resetForTests();
});

test("time spent waiting for a paced slot is recorded on the attempt that waited", async () => {
  const log: string[] = [];
  const chat = createRoutedChat({
    connections: new Map([["groq", { name: "groq", provider: keyed(() => "ok", log), apiKey: "k1" }]]),
    routes: { judge: [{ connection: "groq", model: "g" }] } as never,
    pacer: new Pacer({ groq: 120 }),
  });
  const first = await ask(chat);
  assert.equal(first.attempts[0].waitedMs, undefined, "the first call had its slot at once");
  const second = await ask(chat);
  assert.ok((second.attempts[0].waitedMs ?? 0) >= 100, `waited ${second.attempts[0].waitedMs}`);
});
