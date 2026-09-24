import { ProviderError } from "./types.ts";

/**
 * Says which of the two things the customer typed was wrong.
 *
 * The settings form asks for a key *and* a model, and every failure used to come back
 * as "That key did not work" — so a customer whose key was perfect but whose model id
 * had been retired by the provider was told to go and regenerate their credential. Our
 * own route table rots that way about twice a quarter; theirs will too.
 *
 * The provider already says which it was, in the status code, and discarding it was the
 * whole defect. Measured against Groq on 2026-09-24: a valid key with an unknown model
 * returns 404, not 401.
 *
 * Its own module because `actions.ts` is a `"use server"` file, where every export must
 * be an async server action — and because a decision this load-bearing should be
 * testable without a request.
 */
export function explainKeyFailure(provider: string, model: string, error: unknown): string {
  const status = error instanceof ProviderError ? error.status : undefined;
  const detail = error instanceof Error ? error.message : String(error);

  if (status === 401 || status === 403) {
    return `${provider} did not accept this key. Check it was copied whole, and that it has not been revoked or restricted to other models.`;
  }
  if (status === 429) {
    return `The key reached ${provider}, which is rate-limiting it right now, so we could not finish proving it. Nothing was saved — wait a minute and connect it again. A key is only stored once it has answered.`;
  }
  if (status === 404 || (status === 400 && /model/i.test(detail))) {
    return `The key works. ${provider} does not offer a model called "${model}" to it — check the id, or name another model this key can use.`;
  }
  if (status !== undefined && status >= 500) {
    return `The key reached ${provider} and ${provider} failed to answer (HTTP ${status}). That is their side, not yours or ours. Nothing was saved; try again shortly.`;
  }
  return `That key did not work: ${detail}`;
}
