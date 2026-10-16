import "server-only";
import { serviceClient } from "../supabase/service.ts";
import { rateLimit } from "../support/rate-limit.ts";
import { hashKey, keyFromHeader, LAST_USED_PRECISION_MS, sameHash, shouldRecordUse, type Scope } from "./keys.ts";

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

/** Every refusal names a stable `code` beside its sentence, so a caller can branch without parsing words. */
type RefusalCode = "unauthorized" | "unavailable" | "missing_scope" | "rate_limited";

function refuse(status: number, code: RefusalCode, error: string, headers: Record<string, string> = {}): { ok: false; response: Response } {
  return { ok: false, response: Response.json({ error, code }, { status, headers: { "cache-control": "no-store", ...headers } }) };
}

export async function authenticateApiKey(request: Request, scope: Scope): Promise<ApiAuth> {
  const header = request.headers.get("authorization");
  if (!header) return refuse(401, "unauthorized", "Send a workspace API key as `Authorization: Bearer nvk_…`.", { "www-authenticate": "Bearer" });
  const invalid = () => refuse(401, "unauthorized", "That API key is not valid. It may have been revoked.", { "www-authenticate": "Bearer" });
  const key = keyFromHeader(header);
  if (!key) return invalid();

  let hash: string;
  try {
    hash = hashKey(key);
  } catch {
    return refuse(503, "unavailable", "API keys are not available on this server.");
  }

  const { data } = await serviceClient()
    .from("api_keys")
    .select("id, workspace_id, key_hash, scopes, revoked_at, last_used_at")
    .eq("key_hash", hash)
    .maybeSingle();

  if (!data || data.revoked_at || !sameHash(data.key_hash as string, hash)) return invalid();
  const scopes = (data.scopes as Scope[]) ?? [];
  if (!scopes.includes(scope)) return refuse(403, "missing_scope", `This key does not have the ${scope} scope.`);

  // Allowed when the count cannot be read: the caller is authenticated, most requests are
  // reads, and what a run spends is bounded where runs start (the trial cap, the grading
  // slots), not here.
  const limit = await rateLimit(`api:${data.id}`, API_LIMIT, { onError: "allow" });
  if (!limit.allowed) {
    return refuse(429, "rate_limited", "Too many requests for this key. Slow down and try again in a minute.", { "retry-after": "60" });
  }

  // When the key was last used, to the minute (0070): one conditional write a minute per key,
  // never one per request. Of several requests in the same minute, the condition lets one
  // through; a failure to record it never refuses the request.
  const lastUsed = (data.last_used_at as string | null) ?? null;
  if (shouldRecordUse(lastUsed)) {
    const now = Date.now();
    let update = serviceClient().from("api_keys").update({ last_used_at: new Date(now).toISOString() })
      .eq("id", data.id).is("revoked_at", null);
    update = lastUsed === null
      ? update.is("last_used_at", null)
      : update.lt("last_used_at", new Date(now - LAST_USED_PRECISION_MS).toISOString());
    await update.then(() => undefined, () => undefined);
  }

  return { ok: true, caller: { workspaceId: data.workspace_id as string, keyId: data.id as string, scopes } };
}
