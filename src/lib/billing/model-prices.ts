/**
 * What a call on one of Novera's own paid model keys costs, in US dollars per million tokens.
 *
 * Copied from Google's Gemini API pricing page (https://ai.google.dev/gemini-api/docs/pricing),
 * fetched 2026-10-22, "last updated 2026-10-19", paid tier, prompts up to 200k tokens. The 3.6,
 * 3.8 and 4 prices hold "through December 31, 2026" and rise on 1 January 2027: the launch check
 * fails from then until this table is re-checked (`PRICES_REVIEW_BY`).
 *
 * Only connections that bill Novera are priced. The free tiers (groq, mistral on its free plan,
 * openrouter's `:free` models, the free Google key) cost nothing and are absent; a workspace's
 * own key bills the workspace and is never counted here.
 */
export interface ModelPrice {
  /** Per million input tokens not served from cache. */
  input: number;
  /** Per million input tokens served from Gemini's context cache. */
  cachedInput: number;
  /** Per million output tokens, thinking included: Gemini bills thoughts as output. */
  output: number;
}

export const PRICES_CHECKED_ON = "2026-10-22";
export const PRICES_REVIEW_BY = "2027-01-01";

const GEMINI: Readonly<Record<string, ModelPrice>> = {
  "gemini-4-argon": { input: 4.0, cachedInput: 0.2, output: 20.0 },
  "gemini-3.8-flash": { input: 1.5, cachedInput: 0.15, output: 7.5 },
  "gemini-3.6-flash": { input: 1.5, cachedInput: 0.15, output: 7.5 },
  "gemini-3.5-flash-lite": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-3.1-flash-lite": { input: 0.25, cachedInput: 0.025, output: 1.5 },
  "gemini-3.1-pro-preview": { input: 2.0, cachedInput: 0.2, output: 12.0 },
  "gemini-2.5-pro": { input: 1.25, cachedInput: 0.125, output: 10.0 },
  "gemini-2.5-flash": { input: 0.3, cachedInput: 0.03, output: 2.5 },
  "gemini-2.5-flash-lite": { input: 0.1, cachedInput: 0.01, output: 0.4 },
};

/** A Gemini model missing from the table is priced as the dearest one: never as free. */
const UNKNOWN_GEMINI = GEMINI["gemini-4-argon"];

/** The price of a model on a connection that bills Novera, or null when it bills nobody here. */
export function priceOf(connection: string, model: string): ModelPrice | null {
  if (connection !== "gemini") return null;
  return GEMINI[model] ?? UNKNOWN_GEMINI;
}

export interface CallUsage {
  inputTokens?: number;
  cachedTokens?: number;
  outputTokens?: number;
  thoughtTokens?: number;
}

/** The call's cost in micro-dollars (1e-6 USD), rounded up so a total never under-reads. */
export function costMicroUsd(price: ModelPrice, usage: CallUsage): number {
  const cached = Math.max(0, usage.cachedTokens ?? 0);
  const fresh = Math.max(0, (usage.inputTokens ?? 0) - cached);
  const out = Math.max(0, usage.outputTokens ?? 0) + Math.max(0, usage.thoughtTokens ?? 0);
  return Math.ceil(fresh * price.input + cached * price.cachedInput + out * price.output);
}
