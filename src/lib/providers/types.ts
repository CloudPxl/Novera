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

  constructor(provider: string, message: string, status?: number) {
    super(`${provider}: ${message}`);
    this.name = "ProviderError";
    this.provider = provider;
    this.status = status;
  }
}
