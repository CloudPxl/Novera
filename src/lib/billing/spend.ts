import { costMicroUsd, priceOf, type CallUsage } from "./model-prices.ts";

/**
 * Novera's monthly budget for its own paid model key, and the guard the router asks before
 * each call on it (2026-10-22).
 *
 * Spending stops by degrading, never by refusing: once the month's spend reaches the budget the
 * router skips the paid connection, and grading continues on the free vendors exactly as it did
 * before the paid key existed — each verdict still names the models that gave it. No customer is
 * refused a run because Novera's credit ran out. The total is kept in Postgres (0079) and read at
 * most every ten seconds per server instance; calls already in flight when the budget is reached
 * finish, so the overshoot is bounded by those.
 *
 * When the database cannot be read the guard allows the call: a counting failure must not turn
 * every run into an errored one. The Google Cloud quota caps are the hard stop under this one.
 */
export const DEFAULT_MONTHLY_BUDGET_USD = 50;

export function monthlyBudgetUsd(env: Record<string, string | undefined> = process.env): number {
  const n = Number(env.NOVERA_MODEL_BUDGET_USD);
  return Number.isFinite(n) && n >= 0 ? n : DEFAULT_MONTHLY_BUDGET_USD;
}

export const currentPeriod = (now = new Date()) => `${now.toISOString().slice(0, 7)}-01`;

interface Cached { period: string; microUsd: number; readAt: number }
let cached: Cached | null = null;
const READ_EVERY_MS = 10_000;

async function admin() {
  const { serviceClient } = await import("../supabase/service.ts");
  return serviceClient();
}

/** This month's spend in micro-dollars, from the running total (0079). */
export async function monthSpendMicroUsd(now = new Date()): Promise<number | null> {
  const period = currentPeriod(now);
  if (cached && cached.period === period && Date.now() - cached.readAt < READ_EVERY_MS) return cached.microUsd;
  try {
    const { data, error } = await (await admin()).from("model_spend_months").select("cost_micro_usd").eq("period", period).maybeSingle();
    if (error) return cached?.period === period ? cached.microUsd : null;
    const microUsd = Number(data?.cost_micro_usd ?? 0);
    cached = { period, microUsd, readAt: Date.now() };
    return microUsd;
  } catch {
    return cached?.period === period ? cached.microUsd : null;
  }
}

/** Whether a call on this connection may be made now. Free connections always may. */
export async function spendAllows(connection: string, model: string): Promise<boolean> {
  if (!priceOf(connection, model)) return true;
  const spent = await monthSpendMicroUsd();
  if (spent === null) return true;
  return spent < monthlyBudgetUsd() * 1_000_000;
}

/** Records one call on a paid connection of ours. Never throws: a lost row is not a failed call. */
export async function recordSpend(args: { connection: string; model: string; purpose: string; usage: CallUsage }): Promise<void> {
  const price = priceOf(args.connection, args.model);
  if (!price) return;
  const cost = costMicroUsd(price, args.usage);
  try {
    await (await admin()).from("model_spend").insert({
      connection: args.connection, model: args.model, purpose: args.purpose,
      input_tokens: Math.max(0, args.usage.inputTokens ?? 0),
      cached_tokens: Math.max(0, args.usage.cachedTokens ?? 0),
      output_tokens: Math.max(0, (args.usage.outputTokens ?? 0) + (args.usage.thoughtTokens ?? 0)),
      cost_micro_usd: cost,
    });
    if (cached && cached.period === currentPeriod()) cached.microUsd += cost;
  } catch {
    // Counting must never fail the work it counts.
  }
}

/** For tests: forget the cached total. */
export function resetSpendCache(): void {
  cached = null;
}

/** For tests: set this month's spend as if just read from the database. */
export function setSpendForTests(microUsd: number, now = new Date()): void {
  cached = { period: currentPeriod(now), microUsd, readAt: Date.now() };
}
