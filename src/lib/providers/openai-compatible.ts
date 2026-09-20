import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/**
 * Any /v1/chat/completions endpoint. One adapter covers OpenAI itself and the
 * free-tier hosts that copy its shape, which is what a customer is most likely to
 * already have a key for.
 *
 * The base URL travels with the credential, so it is read from the same config the
 * key came from rather than from a global.
 */
/**
 * Pulls the most specific message available. OpenRouter nests the upstream
 * provider's own message under error.metadata, and losing it turns a diagnosable
 * failure into "Provider returned error".
 */
function describeError(payload: Record<string, unknown> | null, fallback: string): string {
  const error = payload?.error as
    | { message?: string; code?: string | number; metadata?: { raw?: unknown; provider_name?: string } }
    | undefined;
  if (!error) return fallback;

  const parts: string[] = [];
  if (error.message) parts.push(error.message);
  if (error.metadata?.provider_name) parts.push(`via ${error.metadata.provider_name}`);
  if (error.metadata?.raw) {
    const raw = typeof error.metadata.raw === "string" ? error.metadata.raw : JSON.stringify(error.metadata.raw);
    parts.push(raw.slice(0, 200));
  }
  return parts.join(" — ") || fallback;
}

export function openAiCompatibleProvider(baseUrl: string): {
  id: "openai-compatible";
  label: string;
  chat(request: ChatRequest, apiKey: string): Promise<ChatResponse>;
} {
  const root = baseUrl.replace(/\/+$/, "");

  return {
    id: "openai-compatible",
    label: `OpenAI-compatible (${root})`,

    async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
      const messages = [
        ...(request.system ? [{ role: "system", content: request.system }] : []),
        ...request.messages,
      ];

      let response: Response;
      try {
        response = await fetch(`${root}/chat/completions`, {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
          body: JSON.stringify({
            model: request.model,
            messages,
            max_tokens: request.maxTokens ?? 4000,
            ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
          }),
        });
      } catch (error) {
        throw new ProviderError("openai-compatible", error instanceof Error ? error.message : String(error));
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        throw new ProviderError("openai-compatible", describeError(payload, response.statusText), response.status);
      }

      // OpenRouter reports upstream failures as HTTP 200 with an error body, so a
      // 2xx alone does not mean the request worked.
      if (payload?.error) {
        throw new ProviderError("openai-compatible", describeError(payload, "upstream error"), response.status);
      }

      const choices = (payload?.choices ?? []) as Array<{ message?: { content?: string } }>;
      const usage = (payload?.usage ?? {}) as Record<string, number>;

      return {
        text: (choices[0]?.message?.content ?? "").trim(),
        model: (payload?.model as string) ?? request.model,
        usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
        raw: payload,
      };
    },
  };
}
