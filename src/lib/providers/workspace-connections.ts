import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../store/secrets.ts";
import { connectionsFromEnv, type Connection } from "./registry.ts";
import { DEFAULT_ROUTES, routesForConnection, measuredModelsFor, type RouteTable } from "../router/routes.ts";
import { anthropicProvider } from "./anthropic.ts";
import { googleProvider } from "./google.ts";
import { openAiCompatibleProvider } from "./openai-compatible.ts";

/**
 * The credentials that grade one workspace's runs, and the route they can be reached on.
 *
 * A workspace with its own key uses only that key. It does not quietly fall back to
 * our free tier, because the report states who funded the grading and that statement
 * has to stay true — a silent fallback would print "customer-supplied model key" over
 * evidence our allowance paid for.
 *
 * The cost of that honesty is that a single-provider key has fewer places to fall
 * back to, so a rate limit becomes an errored case. An errored case is reported as
 * one. That is the right trade: a visible gap beats a false attribution.
 *
 * **The route comes back with the connections, and that is the point.** `DEFAULT_ROUTES`
 * names the connections *we* hold keys for. Handing it a workspace's single connection
 * resolved no candidate at all for a google, anthropic or openrouter key: the router
 * recorded "no credential configured for this connection" four times and errored every
 * case in the run — after the customer had left the trial on the strength of a settings
 * page promising unmetered grading. Returning both together makes the mismatched pair
 * unspellable rather than merely discouraged.
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

/**
 * Which models a stored judge key may grade with.
 *
 * Keys stored before migration 0025 carry none, so they fall back to whatever our own
 * measured table already trusts on that connection. An empty result is a real answer:
 * the key cannot grade anything, and the caller refuses the run instead of starting one
 * that would produce a page of errors.
 */
export function modelsForStoredKey(provider: string, models: string[] | null): string[] {
  return models?.length ? models : measuredModelsFor(provider);
}

export async function connectionsForWorkspace(args: {
  client: SupabaseClient;
  workspaceId: string;
}): Promise<{
  connections: Map<string, Connection>;
  routes: RouteTable;
  source: "trial_free" | "workspace_key";
}> {
  const key = await revealSecret({ ...args, scope: "judge_key" });

  if (key?.provider) {
    const connection = connectionFor(key.provider, key.value);
    const models = modelsForStoredKey(key.provider, key.models);

    if (connection && models.length) {
      return {
        connections: new Map([[connection.name, connection]]),
        routes: routesForConnection(connection.name, models),
        source: "workspace_key",
      };
    }

    // A stored key we cannot route is not a reason to reach for our own. Falling
    // through to the trial connections here would grade an unmetered workspace on our
    // free tier indefinitely, which is the silent fallback this whole file exists to
    // prevent. `workspaceEntitlement` refuses the run before it starts and says what to
    // fix, so this throw is a backstop rather than a path anyone reaches through the UI.
    throw new Error(
      `This workspace's ${key.provider} key has no model recorded to grade with. `
        + "Name one in Settings, and it will be proved before it is saved.",
    );
  }

  return { connections: connectionsFromEnv(), routes: DEFAULT_ROUTES, source: "trial_free" };
}
