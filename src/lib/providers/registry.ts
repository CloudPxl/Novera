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
  /**
   * A second key for the same provider (`<NAME>_API_KEY_FALLBACK`), tried once when the first is
   * rate limited (429) or refused (401). Same provider, same terms, same data-class ceiling.
   */
  fallbackApiKey?: string;
  /**
   * Every key for this connection, the primary first (`<NAME>_API_KEYS`, comma-separated, then
   * `<NAME>_API_KEY` and `<NAME>_API_KEY_FALLBACK`, duplicates dropped). A key that answers 429 or
   * 401 cools down on its own and the next one is tried at once, without waiting
   * (`src/lib/router/key-pool.ts`). Keys add capacity only when each has its own limit: keys of
   * one organisation share its tokens per minute. Absent means `[apiKey, fallbackApiKey]`.
   */
  apiKeys?: string[];
  /**
   * Whose credential this is. Ours are held to the data ceilings in
   * `src/lib/privacy/data-class.ts`; a customer's own key is their choice of processor.
   * Absent means ours — the stricter reading.
   */
  owner?: "novera" | "customer";
  /** Overrides the table in `data-class.ts` for this connection; for a provider added
   *  under stricter terms than its name's entry, and for tests. */
  ceiling?: import("../privacy/data-class.ts").DataClass;
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
/**
 * A provider key as read from the environment, without the whitespace a paste can carry. A key
 * never contains whitespace, and a header value must be a ByteString: production's Gemini key
 * ended in U+2028 (a line separator a pasted value picked up), so every call on it failed with
 * "Cannot convert argument to a ByteString" from 2026-10-22 until 2026-11-09, and grading fell
 * back to the free vendors. Empty after cleaning is absent.
 */
export function cleanKey(value: string | undefined): string | undefined {
  const cleaned = value?.replace(/[\s\u200B-\u200D\u2060\uFEFF]+/g, "");
  return cleaned ? cleaned : undefined;
}

export function connectionsFromEnv(rawEnv: NodeJS.ProcessEnv = process.env): Map<string, Connection> {
  const connections = new Map<string, Connection>();
  const env = new Proxy(rawEnv, {
    get: (target, name) => (typeof name === "string" && /_API_KEY(_FALLBACK)?$/.test(name) ? cleanKey(target[name]) : Reflect.get(target, name)),
  });

  if (env.JUDGE_FREE_API_KEY && (env.JUDGE_FREE_PROVIDER ?? "google") === "google") {
    connections.set("google", { name: "google", provider: googleProvider, apiKey: env.JUDGE_FREE_API_KEY });
  }
  // The paid Gemini key (AI Studio, billed): its own connection with its own ceiling
  // (src/lib/privacy/data-class.ts), never confused with the free tier above.
  const gemini = keyPool(env, "GEMINI");
  if (gemini.length) {
    connections.set("gemini", { name: "gemini", provider: googleProvider, ...pooled(gemini) });
  }
  if (env.ANTHROPIC_API_KEY) {
    connections.set("anthropic", { name: "anthropic", provider: anthropicProvider, apiKey: env.ANTHROPIC_API_KEY });
  }
  for (const [name, baseUrl] of Object.entries(OPENAI_COMPATIBLE_HOSTS)) {
    const keys = keyPool(env, name.toUpperCase());
    if (keys.length) connections.set(name, { name, provider: openAiCompatibleProvider(baseUrl), ...pooled(keys) });
  }

  return connections;
}

/**
 * A provider's keys from the environment: `<PREFIX>_API_KEYS` (comma-separated), then
 * `<PREFIX>_API_KEY`, then `<PREFIX>_API_KEY_FALLBACK`, each cleaned like a single key, empty
 * entries and duplicates dropped, at most eight.
 */
export function keyPool(env: Record<string, string | undefined>, prefix: string): string[] {
  const listed = (env[`${prefix}_API_KEYS`] ?? "").split(",").map((k) => cleanKey(k));
  const keys: string[] = [];
  for (const key of [...listed, cleanKey(env[`${prefix}_API_KEY`]), cleanKey(env[`${prefix}_API_KEY_FALLBACK`])]) {
    if (key && !keys.includes(key) && keys.length < 8) keys.push(key);
  }
  return keys;
}

function pooled(keys: string[]): Pick<Connection, "apiKey" | "fallbackApiKey" | "apiKeys"> {
  return { apiKey: keys[0], ...(keys[1] ? { fallbackApiKey: keys[1] } : {}), apiKeys: keys };
}
