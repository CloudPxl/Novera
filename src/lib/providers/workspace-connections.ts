import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../store/secrets.ts";
import { connectionsFromEnv, type Connection } from "./registry.ts";
import { anthropicProvider } from "./anthropic.ts";
import { googleProvider } from "./google.ts";
import { openAiCompatibleProvider } from "./openai-compatible.ts";

/**
 * The credentials that grade one workspace's runs.
 *
 * A workspace with its own key uses only that key. It does not quietly fall back to
 * our free tier, because the report states who funded the grading and that statement
 * has to stay true — a silent fallback would print "customer-supplied model key" over
 * evidence our allowance paid for.
 *
 * The cost of that honesty is that a single-provider key has fewer places to fall
 * back to, so a rate limit becomes an errored case. An errored case is reported as
 * one. That is the right trade: a visible gap beats a false attribution.
 */
const BASE_URLS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export function connectionFor(provider: string, apiKey: string): Connection | null {
  if (provider === "google") return { name: "google", provider: googleProvider, apiKey };
  if (provider === "anthropic") return { name: "anthropic", provider: anthropicProvider, apiKey };
  const baseUrl = BASE_URLS[provider];
  if (!baseUrl) return null;
  return { name: provider, provider: openAiCompatibleProvider(baseUrl), apiKey };
}

export async function connectionsForWorkspace(args: {
  client: SupabaseClient;
  workspaceId: string;
}): Promise<{ connections: Map<string, Connection>; source: "trial_free" | "workspace_key" }> {
  const key = await revealSecret({ ...args, scope: "judge_key" });

  if (key?.provider) {
    const connection = connectionFor(key.provider, key.value);
    if (connection) {
      return { connections: new Map([[connection.name, connection]]), source: "workspace_key" };
    }
  }

  return { connections: connectionsFromEnv(), source: "trial_free" };
}
