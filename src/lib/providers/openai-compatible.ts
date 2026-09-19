import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/**
 * Any /v1/chat/completions endpoint. One adapter covers OpenAI itself and the
 * free-tier hosts that copy its shape, which is what a customer is most likely to
 * already have a key for.
 *
 * The base URL travels with the credential, so it is read from the same config the
 * key came from rather than from a global.
 */
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
          }),
        });
      } catch (error) {
        throw new ProviderError("openai-compatible", error instanceof Error ? error.message : String(error));
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        const detail =
          (payload?.error as { message?: string } | undefined)?.message ?? response.statusText;
        throw new ProviderError("openai-compatible", detail, response.status);
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
