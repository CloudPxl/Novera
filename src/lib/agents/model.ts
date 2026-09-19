import type { AgentAdapter, AgentInvocation, AgentResult, ModelAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import type { Provider } from "../providers/types.ts";

/**
 * Runs a system prompt directly against a model, for customers whose "agent" is a
 * prompt rather than a deployed endpoint. The approved policy is appended to the
 * prompt so the run records exactly which policy version produced the behaviour.
 */
export function modelAgent(
  config: ModelAgentConfig,
  provider: Provider,
  apiKey: string,
): AgentAdapter {
  async function call(input: string, policy: string): Promise<AgentResult> {
    const started = Date.now();
    const system = policy
      ? `${config.systemPrompt}\n\n## Approved policy\n${policy}`
      : config.systemPrompt;

    try {
      const response = await provider.chat(
        { model: config.model, system, messages: [{ role: "user", content: input }], maxTokens: 2000 },
        apiKey,
      );

      if (!response.text.trim()) {
        return {
          ok: false, responseText: null, toolActivity: null,
          latencyMs: Date.now() - started, model: response.model, raw: response.raw,
          error: "Agent returned an empty response",
        };
      }

      return {
        ok: true,
        responseText: response.text,
        toolActivity: null,
        latencyMs: Date.now() - started,
        model: response.model,
        usage: response.usage,
        raw: response.raw,
      };
    } catch (error) {
      return {
        ok: false, responseText: null, toolActivity: null,
        latencyMs: Date.now() - started,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    probe: () => call(PROBE_INPUT, ""),
    send: (invocation: AgentInvocation) => call(invocation.input, invocation.policy),
  };
}
