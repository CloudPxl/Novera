import { isTimeout, PROVIDER_TIMEOUT_MS, ProviderError, redactCredentials, retryAfterMs, type ChatRequest, type ChatResponse } from "./types.ts";

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
  // Mistral does not nest: it answers `{"object":"error","message":"Rate limit
  // exceeded",...}`. Read as an OpenAI body that shape has no `error` key at all, so
  // every Mistral failure arrived as the bare HTTP status text — "Too Many Requests"
  // with no indication of which limit, on a provider whose free tier hits one often.
  const flat =
    payload?.object === "error" && typeof payload?.message === "string"
      ? { message: payload.message as string }
      : undefined;
  const error = (payload?.error ?? flat) as
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
          signal: AbortSignal.timeout(request.timeoutMs ?? PROVIDER_TIMEOUT_MS),
        });
      } catch (error) {
        if (isTimeout(error)) {
          throw new ProviderError("openai-compatible", `no answer within ${Math.round((request.timeoutMs ?? PROVIDER_TIMEOUT_MS) / 1000)} s`, undefined, { timedOut: true });
        }
        throw new ProviderError("openai-compatible", error instanceof Error ? error.message : String(error));
      }

      const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        throw new ProviderError(
          "openai-compatible",
          redactCredentials(describeError(payload, response.statusText), apiKey),
          response.status,
          { retryAfterMs: retryAfterMs(response.headers.get("retry-after")) },
        );
      }

      // OpenRouter reports upstream failures as HTTP 200 with an error body, so a
      // 2xx alone does not mean the request worked. `object === "error"` covers the
      // Mistral shape of the same trick.
      if (payload?.error || payload?.object === "error") {
        throw new ProviderError(
          "openai-compatible",
          redactCredentials(describeError(payload, "upstream error"), apiKey),
          response.status,
        );
      }

      const choices = (payload?.choices ?? []) as Array<
        { message?: { content?: string }; finish_reason?: string }
      >;
      const usage = (payload?.usage ?? {}) as Record<string, number>;
      const text = (choices[0]?.message?.content ?? "").trim();

      // An empty completion is the provider failing, not the judge being unreadable.
      // Returning "" let it travel one more layer and surface as an errored case in a
      // customer's report; thrown here, the router simply asks the next model.
      if (!text) {
        throw new ProviderError(
          "openai-compatible",
          `empty completion (finish_reason: ${choices[0]?.finish_reason ?? "none"})`,
          response.status,
        );
      }

      return {
        text,
        model: (payload?.model as string) ?? request.model,
        usage: { inputTokens: usage.prompt_tokens, outputTokens: usage.completion_tokens },
        raw: payload,
      };
    },
  };
}
