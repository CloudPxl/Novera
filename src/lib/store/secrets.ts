import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { seal, open, secretAad, type Sealed } from "../crypto.ts";

/**
 * Sealed credential storage.
 *
 * Plaintext exists only inside these two functions and the caller that needs it for
 * one request. Nothing here logs, returns or serialises a decrypted value, and the
 * `secrets` table has no RLS policy at all, so no client token can reach it.
 */
export type SecretScope = "agent_auth" | "judge_key" | "verification_auth";

export async function storeSecret(args: {
  client: SupabaseClient;
  workspaceId: string;
  scope: SecretScope;
  plaintext: string;
  agentId?: string;
  provider?: string;
  /**
   * For a judge key: the models it may grade with, already proved reachable. Kept with
   * the credential because nothing else can say what this key can serve — see
   * migration 0025.
   */
  models?: string[];
}): Promise<string> {
  const { client, workspaceId, scope, plaintext, agentId, provider, models } = args;
  const sealed = seal(plaintext, secretAad(workspaceId, scope, agentId ?? ""));

  const { data, error } = await client
    .from("secrets")
    .insert({
      workspace_id: workspaceId,
      scope,
      agent_id: agentId ?? null,
      provider: provider ?? null,
      models: models?.length ? models : null,
      ciphertext: sealed.ciphertext,
      iv: sealed.iv,
      tag: sealed.tag,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Could not store credential: ${error.message}`);
  return data.id as string;
}

export async function revealSecret(args: {
  client: SupabaseClient;
  workspaceId: string;
  scope: SecretScope;
  agentId?: string;
}): Promise<{ value: string; provider: string | null; models: string[] | null; createdAt: string } | null> {
  const { client, workspaceId, scope, agentId } = args;

  let query = client
    .from("secrets")
    .select("ciphertext, iv, tag, provider, models, created_at")
    .eq("workspace_id", workspaceId)
    .eq("scope", scope)
    .order("created_at", { ascending: false })
    .limit(1);

  query = agentId ? query.eq("agent_id", agentId) : query.is("agent_id", null);

  const { data, error } = await query.maybeSingle();
  if (error) throw new Error(`Could not read credential: ${error.message}`);
  if (!data) return null;

  const sealed: Sealed = { ciphertext: data.ciphertext, iv: data.iv, tag: data.tag };
  return {
    value: open(sealed, secretAad(workspaceId, scope, agentId ?? "")),
    provider: data.provider ?? null,
    models: Array.isArray(data.models) && data.models.length ? (data.models as string[]) : null,
    createdAt: String(data.created_at),
  };
}
