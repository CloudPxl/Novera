import Anthropic from "@anthropic-ai/sdk";
import { PROVIDER_TIMEOUT_MS, ProviderError, redactCredentials, retryAfterMs, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/** Default when a workspace supplies an Anthropic key without naming a model. */
export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

export const anthropicProvider: Provider = {
  id: "anthropic",
  label: "Anthropic",

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    const client = new Anthropic({ apiKey });

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
