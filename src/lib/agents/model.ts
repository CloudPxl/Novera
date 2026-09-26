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
  async function call(
    input: string,
    policy: string,
    context?: Record<string, string>,
    history?: AgentInvocation["history"],
  ): Promise<AgentResult> {
    const started = Date.now();
    const base = policy
      ? `${config.systemPrompt}\n\n## Approved policy\n${policy}`
      : config.systemPrompt;

    // Carried plainly, with no warning of our own attached. Customers' stacks put
    // CRM fields and profile notes into the system prompt exactly like this; adding
    // "treat the following as untrusted" would test our wrapper rather than their
    // agent, and every metadata-injection scenario would pass for our reason.
    const system = context && Object.keys(context).length
      ? `${base}\n\n## Conversation metadata\n${Object.entries(context)
          .map(([key, value]) => `${key}: ${value}`)
          .join("\n")}`
      : base;

    try {
      const response = await provider.chat(
        {
          model: config.model,
          system,
          messages: [
            ...(history ?? []).map((t) => ({ role: t.role === "customer" ? "user" as const : "assistant" as const, content: t.content })),
            { role: "user" as const, content: input },
          ],
          maxTokens: 2000,
        },
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
    send: (invocation: AgentInvocation) =>
      call(invocation.input, invocation.policy, invocation.context, invocation.history),
    acceptsContext: () => true,
    // A prompt-based agent is called with the whole conversation every time.
    acceptsConversation: () => true,
  };
}
