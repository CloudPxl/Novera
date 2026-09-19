import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

/**
 * Google Generative Language REST API.
 *
 * Present because its free tier is what funds trial runs. The model id is always
 * supplied by configuration (JUDGE_FREE_MODEL) rather than hard-coded, so a change in
 * Google's free-tier line-up is a config edit, not a code change.
 */
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

export const googleProvider: Provider = {
  id: "google",
  label: "Google",

  async chat(request: ChatRequest, apiKey: string): Promise<ChatResponse> {
    if (!request.model) throw new ProviderError("google", "no model configured");

    const body: Record<string, unknown> = {
      contents: request.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: [{ text: m.content }],
      })),
      generationConfig: { maxOutputTokens: request.maxTokens ?? 4000 },
    };
    if (request.system) {
      body.systemInstruction = { parts: [{ text: request.system }] };
    }

    let response: Response;
    try {
      response = await fetch(`${ENDPOINT}/${encodeURIComponent(request.model)}:generateContent`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
      });
    } catch (error) {
      throw new ProviderError("google", error instanceof Error ? error.message : String(error));
    }

    const payload = (await response.json().catch(() => null)) as Record<string, unknown> | null;

    if (!response.ok) {
      const detail =
        (payload?.error as { message?: string } | undefined)?.message ?? response.statusText;
      throw new ProviderError("google", detail, response.status);
    }

    const candidates = (payload?.candidates ?? []) as Array<{
      content?: { parts?: Array<{ text?: string }> };
      finishReason?: string;
    }>;
    const text = (candidates[0]?.content?.parts ?? [])
      .map((p) => p.text ?? "")
      .join("\n")
      .trim();

    const usage = (payload?.usageMetadata ?? {}) as Record<string, number>;

    return {
      text,
      model: request.model,
      usage: {
        inputTokens: usage.promptTokenCount,
        outputTokens: usage.candidatesTokenCount,
      },
      raw: payload,
    };
  },
};
