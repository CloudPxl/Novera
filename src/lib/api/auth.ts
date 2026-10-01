import "server-only";
import { serviceClient } from "../supabase/service.ts";
import { rateLimit } from "../support/rate-limit.ts";
import { hashKey, keyFromHeader, sameHash, type Scope } from "./keys.ts";

/**
 * The gate in front of every API route.
 *
 * Answers in the shape an API caller reads — a status and a JSON body — never with a
 * redirect: a route that redirected an unauthenticated `fetch` to the sign-in page
 * handed it a 200 and an HTML page once already (see CLAUDE.md, "a refusal has to be in
 * the shape its caller reads").
 *
 * A key that was sent and is malformed, unknown or revoked always gets the same 401, so a
 * caller cannot use the difference to learn which keys exist. Only a request with no key
 * at all is told how to send one.
 */

export interface ApiCaller {
  workspaceId: string;
  keyId: string;
  scopes: Scope[];
}

/** Generous for a pipeline, tight for a scraper. Counted in Postgres, per key. */
export const API_LIMIT = { max: 120, windowSeconds: 60 };

export type ApiAuth = { ok: true; caller: ApiCaller } | { ok: false; response: Response };

function refuse(status: number, error: string, headers: Record<string, string> = {}): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error }, { status, headers: { "cache-control": "no-store", ...headers } }) };
}

export async function authenticateApiKey(request: Request, scope: Scope): Promise<ApiAuth> {
  const header = request.headers.get("authorization");
  if (!header) return refuse(401, "Send a workspace API key as `Authorization: Bearer nvk_…`.", { "www-authenticate": "Bearer" });
  const invalid = () => refuse(401, "That API key is not valid. It may have been revoked.", { "www-authenticate": "Bearer" });
  const key = keyFromHeader(header);
  if (!key) return invalid();

  let hash: string;
  try {
    hash = hashKey(key);
  } catch {
    return refuse(503, "API keys are not available on this server.");
  }

  const { data } = await serviceClient()
    .from("api_keys")
    .select("id, workspace_id, key_hash, scopes, revoked_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!data || data.revoked_at || !sameHash(data.key_hash as string, hash)) return invalid();
  const scopes = (data.scopes as Scope[]) ?? [];
  if (!scopes.includes(scope)) return refuse(403, `This key does not have the ${scope} scope.`);

  // Allowed when the count cannot be read: the caller is authenticated, most requests are
  // reads, and what a run spends is bounded where runs start (the trial cap, the grading
  // slots), not here.
  const limit = await rateLimit(`api:${data.id}`, API_LIMIT, { onError: "allow" });
  if (!limit.allowed) {
    return refuse(429, "Too many requests for this key. Slow down and try again in a minute.", { "retry-after": "60" });
  }

  return { ok: true, caller: { workspaceId: data.workspace_id as string, keyId: data.id as string, scopes } };
}
