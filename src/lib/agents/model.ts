import type { AgentAdapter, AgentInvocation, AgentResult, ModelAgentConfig } from "./types.ts";
import { PROBE_INPUT } from "./types.ts";
import { ProviderError, type Provider } from "../providers/types.ts";
import { AGENT_TIMEOUT_MAX_MS } from "./http.ts";

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
    deadline?: number,
  ): Promise<AgentResult> {
    const started = Date.now();
    // The same bound an HTTP agent has: its own 30 s at most, and never past the slice.
    const wait = deadline === undefined ? AGENT_TIMEOUT_MAX_MS : Math.min(AGENT_TIMEOUT_MAX_MS, deadline - started);
    if (wait < 2_000) {
      return {
        ok: false, responseText: null, toolActivity: null, latencyMs: 0, timedOut: true, cutByNovera: true,
        error: "Not sent: this run's time slice was ending. This says nothing about the agent; retest the scenario.",
      };
    }
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
          timeoutMs: wait,
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
      const timedOut = error instanceof ProviderError && error.timedOut;
      const cut = timedOut && wait < AGENT_TIMEOUT_MAX_MS;
      return {
        ok: false, responseText: null, toolActivity: null,
        latencyMs: Date.now() - started,
        ...(timedOut ? { timedOut: true } : {}),
        ...(cut ? { cutByNovera: true } : {}),
        error: cut
          ? `Novera stopped waiting after ${Math.round(wait / 1000)} s because this run's time slice was ending. This says nothing about the agent; retest the scenario.`
          : error instanceof Error ? error.message : String(error),
      };
    }
  }

  return {
    probe: () => call(PROBE_INPUT, ""),
    send: (invocation: AgentInvocation) =>
      call(invocation.input, invocation.policy, invocation.context, invocation.history, invocation.deadline),
    acceptsContext: () => true,
    // A prompt-based agent is called with the whole conversation every time.
    acceptsConversation: () => true,
  };
}
