import { anthropicProvider } from "./anthropic.ts";
import { googleProvider } from "./google.ts";
import { openAiCompatibleProvider } from "./openai-compatible.ts";
import type { Provider } from "./types.ts";

/**
 * A named credential plus the provider that knows how to use it.
 *
 * Connections are named ("google", "groq", "openrouter") rather than typed, because
 * two connections can share a provider implementation — Groq and OpenRouter are both
 * OpenAI-compatible but have different keys, base URLs and model names.
 */
export interface Connection {
  name: string;
  provider: Provider;
  apiKey: string;
}

/**
 * Every OpenAI-compatible host we hold a key for, keyed by connection name. The key
 * is read from `<NAME>_API_KEY`, so adding a host is one line here plus one line in
 * `.env.local` — no code change.
 *
 * `mistral` and `openai` were added on 2026-09-22. They matter for a reason beyond
 * capacity: corroboration is only worth as much as the independence of the models
 * doing it. Before this, both votes on a case could come from `groq/openai/gpt-oss-*`
 * — one vendor, one family, one shared blind spot, and one rate limit away from
 * losing both. See `src/lib/judge/independence.ts`.
 */
const OPENAI_COMPATIBLE_HOSTS: Record<string, string> = {
  groq: "https://api.groq.com/openai/v1",
  openrouter: "https://openrouter.ai/api/v1",
  mistral: "https://api.mistral.ai/v1",
  openai: "https://api.openai.com/v1",
};

/**
 * Connections available from the server environment. These fund trial runs; a paid
 * workspace's own key is resolved separately and never comes from here.
 */
export function connectionsFromEnv(env: NodeJS.ProcessEnv = process.env): Map<string, Connection> {
  const connections = new Map<string, Connection>();

  if (env.JUDGE_FREE_API_KEY && (env.JUDGE_FREE_PROVIDER ?? "google") === "google") {
    connections.set("google", { name: "google", provider: googleProvider, apiKey: env.JUDGE_FREE_API_KEY });
  }
  if (env.ANTHROPIC_API_KEY) {
    connections.set("anthropic", { name: "anthropic", provider: anthropicProvider, apiKey: env.ANTHROPIC_API_KEY });
  }
  for (const [name, baseUrl] of Object.entries(OPENAI_COMPATIBLE_HOSTS)) {
    const key = env[`${name.toUpperCase()}_API_KEY`];
    if (key) {
      connections.set(name, { name, provider: openAiCompatibleProvider(baseUrl), apiKey: key });
    }
  }

  return connections;
}
