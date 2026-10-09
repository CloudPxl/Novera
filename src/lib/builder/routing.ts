import { DEFAULT_ROUTES, type Candidate, type RouteTable } from "../router/routes.ts";
import { allows, ceilingFor } from "../privacy/data-class.ts";

/**
 * Which providers may read a customer's document, said before anyone adds one. Derived
 * from the same route table and data-class ceilings the router enforces on the call, so
 * the notice and the behaviour cannot disagree.
 */
export function documentRoute(
  configured: Set<string>,
  // A workspace with its own key reads documents on that key's route (src/lib/providers/model-work.ts).
  options: { routes?: RouteTable; owner?: "novera" | "customer" } = {},
): { allowed: Candidate[]; excluded: Candidate[] } {
  const draft = (options.routes ?? DEFAULT_ROUTES).draft;
  const permitted = (c: Candidate) => allows(ceilingFor({ name: c.connection, owner: options.owner }), "redacted_customer");
  return {
    allowed: draft.filter((c) => configured.has(c.connection) && permitted(c)),
    excluded: draft.filter((c) => !permitted(c)),
  };
}

const NAMES: Record<string, string> = { groq: "Groq", mistral: "Mistral", google: "Google", openrouter: "OpenRouter", openai: "OpenAI", anthropic: "Anthropic" };
export const providerName = (connection: string) => NAMES[connection] ?? connection;
