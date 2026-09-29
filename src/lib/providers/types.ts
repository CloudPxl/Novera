/**
 * A minimal chat surface shared by every provider Novera can call.
 *
 * Two different things use it: the `model` agent adapter (running the customer's
 * system prompt as the agent under test) and the judge. Keeping one interface means
 * a customer can point either at whichever provider their key belongs to.
 */
export interface ChatRequest {
  model: string;
  system?: string;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
  maxTokens?: number;
  /**
   * Sampling temperature. Grading passes 0: a verdict that changes between two runs
   * over an identical response is not evidence, and leaving this unset meant every
   * provider's own default applied — 1.0 on the OpenAI-compatible hosts.
   */
  temperature?: number;
  /**
   * "off" asks the provider not to spend the output budget on hidden reasoning.
   *
   * Grading wants one small JSON object, and hidden reasoning is charged against the
   * same `maxTokens` as the answer. `gemini-3.5-flash` spent the whole judge budget
   * thinking and returned empty text on 11 of 11 calibration cases — measured as "no
   * readable verdict", indistinguishable from a broken model. Only providers that
   * expose the control act on it; the rest ignore it.
   */
  reasoning?: "off";
  /**
   * How long to wait for the answer. The router lowers it to what is left of a run's
   * time slice; without it, `PROVIDER_TIMEOUT_MS`. A provider that hangs must not
   * take the function past the platform's hard limit with it.
   */
  timeoutMs?: number;
}

/** No single model call is waited on longer than this. */
export const PROVIDER_TIMEOUT_MS = 20_000;

/** Whether an error thrown by fetch (or an SDK built on it) is our own timeout firing. */
export function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return error.name === "TimeoutError" || error.name === "AbortError" || /timed? ?out/i.test(error.message);
}

export interface ChatResponse {
  text: string;
  model: string;
  usage: { inputTokens?: number; outputTokens?: number };
  /** Kept verbatim as evidence; never shown in a client report. */
  raw: unknown;
}

export interface Provider {
  id: ProviderId;
  label: string;
  chat(request: ChatRequest, apiKey: string): Promise<ChatResponse>;
}

export type ProviderId = "anthropic" | "google" | "openai-compatible";

/**
 * Removes credential material from a provider's own words before we keep them.
 *
 * Every provider failure is stored — `judge_attempts` on the case row — and shown to
 * the operator, which makes an upstream error message a place a key could end up
 * durably. Some hosts echo the request back in `error.metadata.raw`, and the product
 * rule is that a customer's key never appears in a log, a report or a screenshot. So
 * the boundary enforces it rather than trusting the provider not to say it.
 *
 * The exact key is redacted first, then anything key-shaped, so a *second* key the
 * caller did not pass — one belonging to another workspace, echoed by a shared proxy —
 * is caught too.
 */
const KEY_SHAPED = /\b(?:sk-[A-Za-z0-9_-]{8,}|gsk_[A-Za-z0-9]{8,}|AIza[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{12,})/g;

export function redactCredentials(text: string, apiKey?: string): string {
  let out = text;
  if (apiKey && apiKey.length >= 8) out = out.split(apiKey).join("[redacted]");
  return out.replace(KEY_SHAPED, "[redacted]");
}

export class ProviderError extends Error {
  provider: string;
  status?: number;
  /** The call was abandoned because no answer came in time. */
  timedOut: boolean;
  /** From a 429's Retry-After header, when the provider sent one. */
  retryAfterMs?: number;

  constructor(provider: string, message: string, status?: number, extra: { timedOut?: boolean; retryAfterMs?: number } = {}) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
    this.timedOut = extra.timedOut ?? false;
    if (extra.retryAfterMs !== undefined) this.retryAfterMs = extra.retryAfterMs;
  }
}

/** Retry-After as milliseconds: seconds or an HTTP date. Undefined when absent or unreadable. */
export function retryAfterMs(header: string | null | undefined, now = Date.now()): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.round(seconds * 1000);
  const at = Date.parse(header);
  return Number.isNaN(at) ? undefined : Math.max(0, at - now);
}
