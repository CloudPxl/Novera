import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_TIMEOUT_MS, ProviderError, redactCredentials, retryAfterMs, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/**
 * Default when a workspace supplies an Anthropic key without naming a model. A grading model
 * must accept `temperature: 0`; among current Claude models Haiku 4.5 does, and the Opus 5
 * this used to name rejects sampling parameters (third-vendor review, 2026-10-10).
 */
export const DEFAULT_ANTHROPIC_MODEL = "claude-haiku-4-5";

export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic",

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    // No retries inside the SDK: the router owns fallback and the circuit breaker, and an
    // SDK-level retry hid a 429 from both while spending the case's deadline.
    const client = new Anthropic({ apiKey, maxRetries: 0 });

    try {
      const response = await client.messages.create({
        model: request.model || DEFAULT_ANTHROPIC_MODEL,
        max_tokens: request.maxTokens ?? 4000,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      }, { timeout: request.timeoutMs ?? PROVIDER_TIMEOUT_MS });

      // content is a discriminated union; narrow before reading .text
      const text = response.content
        .filter((block) => block.type === "text")
        .map((block) => (block as { type: "text"; text: string }).text)
        .join("\n")
        .trim();

      if (response.stop_reason === "refusal") {
        throw new ProviderError("anthropic", "the model declined the request");
      }

      return {
        text,
        model: response.model,
        usage: {
          inputTokens: response.usage?.input_tokens,
          outputTokens: response.usage?.output_tokens,
        },
        raw: response,
      };
    } catch (error) {
      if (error instanceof ProviderError) throw error;
      if (error instanceof Anthropic.APIConnectionTimeoutError) {
        throw new ProviderError("anthropic", `no answer within ${Math.round((request.timeoutMs ?? PROVIDER_TIMEOUT_MS) / 1000)} s`, undefined, { timedOut: true });
      }
      if (error instanceof Anthropic.APIError) {
        const headers = error.headers as { get?: (name: string) => string | null } | undefined;
        throw new ProviderError("anthropic", redactCredentials(error.message, apiKey), error.status,
          { retryAfterMs: retryAfterMs(headers?.get?.("retry-after")) });
      }
      throw new ProviderError(
        "anthropic",
        redactCredentials(error instanceof Error ? error.message : String(error), apiKey),
      );
    }
  },
};
