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
      generationConfig: {
        maxOutputTokens: request.maxTokens ?? 4000,
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        // Verified 2026-09-22: with thinking left on, a judge-sized prompt at 1000
        // output tokens comes back with finishReason STOP and no text at all — the
        // whole budget went on thoughts. `thinkingLevel` is the Gemini 3.x control;
        // the 2.x `thinkingBudget: 0` is rejected outright by gemini-3.5-flash-lite
        // (HTTP 400), so using it would have turned a slow route into a broken one.
        ...(request.reasoning === "off" ? { thinkingConfig: { thinkingLevel: "low" } } : {}),
      },
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

    // No text is the provider failing, not the judge being unreadable — most often
    // the whole output budget went on hidden reasoning. Thrown here, the router asks
    // the next model; returned as "", it travelled two more layers and landed in a
    // customer's report as an errored case.
    if (!text) {
      throw new ProviderError(
        "google",
        `empty completion (finishReason: ${candidates[0]?.finishReason ?? "none"}, `
          + `thoughtTokens: ${usage.thoughtsTokenCount ?? 0})`,
        response.status,
      );
    }

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
