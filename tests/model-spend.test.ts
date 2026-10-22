import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { costMicroUsd, priceOf, PRICES_REVIEW_BY } from "../src/lib/billing/model-prices.ts";
import { monthlyBudgetUsd, resetSpendCache, setSpendForTests, spendAllows } from "../src/lib/billing/spend.ts";
import { createRoutedChat } from "../src/lib/router/execute.ts";
import { DEFAULT_ROUTES } from "../src/lib/router/routes.ts";
import { ceilingFor } from "../src/lib/privacy/data-class.ts";
import { vendorOf, independenceOf } from "../src/lib/judge/independence.ts";
import { connectionsFromEnv } from "../src/lib/providers/registry.ts";
import { modelSpendRow } from "../src/lib/readiness/launch-checks.ts";
import type { Provider } from "../src/lib/providers/types.ts";

/** The paid Gemini key (2026-10-22): its connection, its price, its monthly budget. */

test("only Novera's paid Gemini connection is priced; an unknown Gemini model is priced as the dearest, never free", () => {
  assert.deepEqual(priceOf("gemini", "gemini-3.8-flash"), { input: 1.5, cachedInput: 0.15, output: 7.5 });
  assert.deepEqual(priceOf("gemini", "gemini-9-future"), priceOf("gemini", "gemini-4-argon"));
  for (const free of ["groq", "mistral", "openrouter", "google"]) assert.equal(priceOf(free, "x"), null, free);
  // 3,000 input of which 2,000 cached, 300 visible output, 200 thinking, on 3.8-flash:
  // 1,000 × 1.5 + 2,000 × 0.15 + 500 × 7.5 = 1,500 + 300 + 3,750 micro-dollars.
  assert.equal(costMicroUsd(priceOf("gemini", "gemini-3.8-flash")!, { inputTokens: 3000, cachedTokens: 2000, outputTokens: 300, thoughtTokens: 200 }), 5550);
  assert.equal(PRICES_REVIEW_BY, "2027-01-01");
});

test("the monthly budget defaults to $50 and is read from NOVERA_MODEL_BUDGET_USD", () => {
  assert.equal(monthlyBudgetUsd({}), 50);
  assert.equal(monthlyBudgetUsd({ NOVERA_MODEL_BUDGET_USD: "120" }), 120);
  assert.equal(monthlyBudgetUsd({ NOVERA_MODEL_BUDGET_USD: "nonsense" }), 50);
});

test("once the budget is spent the paid connection is passed over and grading continues on a free one", async () => {
  const asked: string[] = [];
  const stub = (name: string) => ({ id: "openai-compatible", label: name, async chat() { asked.push(name); return { text: "ok", model: "m", usage: { inputTokens: 10, outputTokens: 5 }, raw: null }; } }) as unknown as Provider;
  const chat = createRoutedChat({
    connections: new Map([
      ["gemini", { name: "gemini", provider: stub("gemini"), apiKey: "k" }],
      ["groq", { name: "groq", provider: stub("groq"), apiKey: "k" }],
    ]),
    routes: { judge: [{ connection: "gemini", model: "gemini-3.8-flash" }, { connection: "groq", model: "g" }] } as never,
  });
  setSpendForTests(50_000_000);
  const out = await chat("judge", { messages: [{ role: "user", content: "x" }] }, { data: "public" });
  assert.deepEqual(asked, ["groq"]);
  assert.equal(out.attempts[0].reason, "budget_spent");
  assert.equal(out.servedBy?.connection, "groq");
  setSpendForTests(49_999_000);
  asked.length = 0;
  assert.equal(await spendAllows("gemini", "gemini-3.8-flash"), true);
  assert.equal(await spendAllows("groq", "x"), true, "a free connection is never gated");
  resetSpendCache();
});

test("a workspace's own Gemini key is never gated or counted against Novera's budget", async () => {
  let called = 0;
  const chat = createRoutedChat({
    connections: new Map([["gemini", { name: "gemini", owner: "customer" as const, provider: { id: "openai-compatible", label: "c", async chat() { called++; return { text: "ok", model: "m", usage: {}, raw: null }; } } as unknown as Provider, apiKey: "k" }]]),
    routes: { judge: [{ connection: "gemini", model: "gemini-3.8-flash" }] } as never,
  });
  setSpendForTests(999_000_000);
  await chat("judge", { messages: [{ role: "user", content: "x" }] }, { data: "public" });
  assert.equal(called, 1);
  resetSpendCache();
});

test("the paid key is its own connection, may read client content, and is the same vendor as the free Google key", () => {
  const c = connectionsFromEnv({ GEMINI_API_KEY: "k" } as never).get("gemini");
  assert.ok(c);
  assert.equal(ceilingFor(c!), "identifiable_customer");
  assert.equal(ceilingFor({ name: "google" }), "synthetic", "the free tier is unchanged");
  assert.equal(vendorOf("gemini/gemini-3.8-flash"), "google");
  assert.equal(independenceOf([{ model: "gemini/gemini-3.8-flash", status: "pass" }, { model: "google/gemini-3.5-flash-lite", status: "pass" }]), "single-vendor");
});

test("routes: the calibrated Gemini model is the third vendor in grading and leads diagnosis; the uncalibrated ones are nowhere", () => {
  for (const task of ["judge", "judge_critical"] as const) {
    assert.deepEqual(DEFAULT_ROUTES[task].slice(0, 3).map((c) => `${c.connection}/${c.model}`), ["groq/openai/gpt-oss-20b", "mistral/ministral-8b-latest", "gemini/gemini-3.8-flash"]);
  }
  assert.equal(DEFAULT_ROUTES.diagnose[0].model, "gemini-3.8-flash");
  const all = Object.values(DEFAULT_ROUTES).flat();
  assert.ok(!all.some((c) => c.connection === "google"), "the free Google key is in no route");
  assert.ok(!all.some((c) => c.model === "gemini-3.5-flash-lite" || c.model === "gemini-4-argon"), "a model with a false pass, or too slow, is not routed");
});

test("the spend launch check: spent, budget reached, unreadable, prices out of date, no paid key", () => {
  const env = { GEMINI_API_KEY: "k" };
  const at = new Date("2026-11-15T00:00:00Z");
  assert.equal(modelSpendRow({ spentMicroUsd: 12_340_000, env, now: at }).status, "pass");
  assert.match(modelSpendRow({ spentMicroUsd: 12_340_000, env, now: at }).detail, /\$12\.34 of the \$50 monthly budget spent/);
  assert.equal(modelSpendRow({ spentMicroUsd: 50_000_000, env, now: at }).status, "pending");
  assert.equal(modelSpendRow({ spentMicroUsd: null, env, now: at }).status, "pending");
  assert.equal(modelSpendRow({ spentMicroUsd: 0, env, now: new Date("2027-01-02T00:00:00Z") }).status, "fail");
  assert.equal(modelSpendRow({ spentMicroUsd: null, env: {}, now: at }).status, "pass");
});

test("0079 keeps the spend append-only, totals it per month, and holds no tenant or personal data", () => {
  const m = readFileSync("supabase/migrations/0079_model_spend.sql", "utf8");
  assert.match(m, /create table if not exists model_spend \(/);
  assert.match(m, /raise exception 'model_spend is append-only'/);
  assert.match(m, /on conflict \(period\) do update/);
  assert.doesNotMatch(m.slice(m.indexOf("create table if not exists model_spend ("), m.indexOf("create index")), /workspace_id|user_id|prompt|reply/);
});
