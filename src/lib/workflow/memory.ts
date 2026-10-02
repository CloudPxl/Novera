import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { recordAudit } from "@/lib/audit/record.ts";
import { checkMemoryValue, SINGLE_VALUE, type MemoryKey } from "@/lib/assistant/memory.ts";

/**
 * The one way a memory is written, whatever asked for it: a setting, "Remember this", or an
 * accepted suggestion. The value is checked again here — the caller's check is not trusted —
 * a single-valued key replaces its previous value, and every write is in the audit trail.
 */
export async function saveMemory(admin: SupabaseClient, m: {
  userId: string;
  workspaceId: string | null;
  key: MemoryKey;
  value: string;
  source: "settings" | "user_said" | "approved_candidate";
  sourceMessageId?: string | null;
  expiresAt?: string | null;
}): Promise<{ id: string } | { error: string }> {
  const check = checkMemoryValue(m.key, m.value);
  if (!check.ok) return { error: check.reason };

  if (SINGLE_VALUE.has(m.key)) {
    let q = admin.from("assistant_memory").delete().eq("user_id", m.userId).eq("key", m.key);
    q = m.workspaceId ? q.eq("workspace_id", m.workspaceId) : q.is("workspace_id", null);
    await q;
  }
  const { data, error } = await admin.from("assistant_memory").insert({
    user_id: m.userId, workspace_id: m.workspaceId, key: m.key, value: check.value, source: m.source,
    source_message_id: m.sourceMessageId ?? null, expires_at: m.expiresAt ?? null,
  }).select("id").single();
  if (error || !data) return { error: `Could not save that: ${error?.message ?? "no row"}` };
  await recordAudit(admin, {
    workspaceId: m.workspaceId, actorId: m.userId, action: "memory.created",
    detail: { key: m.key, scope: m.workspaceId ? "workspace" : "personal", source: m.source },
  });
  return { id: data.id as string };
}
