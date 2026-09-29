"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { mintKey } from "@/lib/api/keys.ts";

export interface KeyFormState {
  error?: string;
  notice?: string;
  /** The new key, returned exactly once. It is not stored and cannot be shown again. */
  key?: string;
}

const MAX_ACTIVE_KEYS = 10;

/**
 * Creates a key for this workspace — read-only unless the person ticked "can also start
 * runs", which spends a trial run or grading on their own model key each time, or "can
 * also ask for drafts and diagnoses", which spends model calls and stores proposals a
 * person then decides. The key is in the reply and nowhere else.
 */
export async function createApiKey(_prev: KeyFormState, form: FormData): Promise<KeyFormState> {
  const { user, workspace } = await requireWorkspace();
  const name = String(form.get("name") ?? "").trim();
  if (!name) return { error: "Name the key after where it will be used, e.g. “GitHub Actions”." };
  if (name.length > 80) return { error: "Keep the name under 80 characters." };

  const admin = await assertMembership(user.id, workspace.id);
  const { count } = await admin.from("api_keys").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).is("revoked_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
    return { error: `This workspace already has ${MAX_ACTIVE_KEYS} active keys. Revoke one you no longer use first.` };
  }

  let minted;
  try {
    minted = mintKey();
  } catch {
    return { error: "API keys are not available on this server." };
  }

  const { error } = await admin.from("api_keys").insert({
    workspace_id: workspace.id,
    name,
    prefix: minted.prefix,
    key_hash: minted.hash,
    scopes: ["read", ...(form.get("canRun") === "on" ? ["run"] : []), ...(form.get("canWrite") === "on" ? ["write"] : [])],
    created_by: user.id,
  });
  if (error) return { error: `The key could not be created: ${error.message}` };

  revalidatePath("/settings");
  return {
    key: minted.key,
    notice: "Copy this key now. Novera keeps only a fingerprint of it, so it cannot be shown again.",
  };
}

/** Revokes a key for good. Requests using it are refused from the next one on. */
export async function revokeApiKey(_prev: KeyFormState, form: FormData): Promise<KeyFormState> {
  const { user, workspace } = await requireWorkspace();
  const keyId = String(form.get("keyId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const { data, error } = await admin.from("api_keys")
    .update({ revoked_at: new Date().toISOString(), revoked_by: user.id })
    .eq("id", keyId).eq("workspace_id", workspace.id).is("revoked_at", null)
    .select("id");
  if (error) return { error: `The key could not be revoked: ${error.message}` };
  if (!data?.length) return { error: "That key was not found, or is already revoked." };

  revalidatePath("/settings");
  return { notice: "Revoked. Any request using it is refused from now on." };
}
