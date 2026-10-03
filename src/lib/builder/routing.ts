import { DEFAULT_ROUTES, type Candidate } from "../router/routes.ts";
import { allows, ceilingFor } from "../privacy/data-class.ts";

/**
 * Which providers may read a customer's document, said before anyone adds one. Derived
 * from the same route table and data-class ceilings the router enforces on the call, so
 * the notice and the behaviour cannot disagree.
 */
export function documentRoute(configured: Set<string>): { allowed: Candidate[]; excluded: Candidate[] } {
  const draft = DEFAULT_ROUTES.draft;
  const permitted = (c: Candidate) => allows(ceilingFor({ name: c.connection }), "redacted_customer");
  return {
    allowed: draft.filter((c) => configured.has(c.connection) && permitted(c)),
    excluded: draft.filter((c) => !permitted(c)),
  };
}

const NAMES: Record<string, string> = { groq: "Groq", mistral: "Mistral", google: "Google", openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Anthropic" };
export const providerName = (connection: string) => NAMES[connection] ?? connection;
