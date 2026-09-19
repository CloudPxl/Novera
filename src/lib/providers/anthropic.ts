import Anthropic from "@anthropic-ai/sdk";
import { ProviderError, type ChatRequest, type ChatResponse, type Provider } from "./types.ts";

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
        ...(request.system ? { system: request.system } : {}),
        messages: request.messages.map((m) => ({ role: m.role, content: m.content })),
      });

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
      if (error instanceof Anthropic.APIError) {
        throw new ProviderError("anthropic", error.message, error.status);
      }
      throw new ProviderError("anthropic", error instanceof Error ? error.message : String(error));
    }
  },
};
