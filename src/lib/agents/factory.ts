import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentAdapter, AgentConfig, HttpAgentConfig, ModelAgentConfig } from "./types.ts";
import { httpAgent } from "./http.ts";
import { modelAgent } from "./model.ts";
import { revealSecret } from "../store/secrets.ts";
import { connectionsFromEnv } from "../providers/registry.ts";
import { openAiCompatibleProvider } from "../providers/openai-compatible.ts";
import { anthropicProvider } from "../providers/anthropic.ts";
import { googleProvider } from "../providers/google.ts";
import type { Provider } from "../providers/types.ts";

/**
 * Turns a stored agent row into something runnable.
 *
 * Credentials are decrypted here and handed straight to the adapter. They are never
 * returned, logged, or attached to anything that gets persisted.
 */
export async function buildAgentAdapter(args: {
  client: SupabaseClient;
  workspaceId: string;
  agentId: string;
  config: AgentConfig;
}): Promise<AgentAdapter> {
  const { client, workspaceId, agentId, config } = args;

  if (config.kind === "http") {
    const secret = await revealSecret({ client, workspaceId, scope: "agent_auth", agentId });
    return httpAgent(config as HttpAgentConfig, secret?.value);
  }

  const model = config as ModelAgentConfig;

  // A workspace's own key first; the shared trial credential only if it has none.
  const own = await revealSecret({ client, workspaceId, scope: "judge_key" });
  const apiKey = own?.value ?? connectionsFromEnv().get(model.provider)?.apiKey;
  if (!apiKey) {
    throw new Error(`No credential available for provider "${model.provider}"`);
  }

  return modelAgent(model, providerFor(model), apiKey);
}

function providerFor(config: ModelAgentConfig): Provider {
  switch (config.provider) {
    case "anthropic":
      return anthropicProvider;
    case "google":
      return googleProvider;
    case "openai-compatible":
      if (!config.baseUrl) throw new Error("An openai-compatible agent needs a baseUrl");
      return openAiCompatibleProvider(config.baseUrl);
  }
}
