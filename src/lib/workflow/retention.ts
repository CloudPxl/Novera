"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { RETENTION_CHOICES } from "@/lib/privacy/retention.ts";
import { recordAudit } from "@/lib/audit/record.ts";

export interface RetentionFormState {
  error?: string;
  notice?: string;
}

/**
 * Sets how long this workspace keeps agents' raw replies. The owner's decision only:
 * shortening it empties evidence at the next daily pass, and that cannot be undone.
 */
export async function setRetention(_prev: RetentionFormState, form: FormData): Promise<RetentionFormState> {
  const { user, workspace } = await requireWorkspace();
  const days = Number(form.get("days"));
  if (!RETENTION_CHOICES.includes(days as (typeof RETENTION_CHOICES)[number])) {
    return { error: "Choose one of the periods offered." };
  }

  const gated = await gate(user.id, workspace.id, "retention.change");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;
  const { data: member } = await admin.from("workspace_members").select("role")
    .eq("workspace_id", workspace.id).eq("user_id", user.id).maybeSingle();
  if (member?.role !== "owner") return { error: "Only the workspace owner can change how long evidence is kept." };

  const { error } = await admin.from("workspaces").update({ raw_evidence_days: days }).eq("id", workspace.id);
  if (error) return { error: `The setting could not be saved: ${error.message}` };

  await recordAudit(admin, { workspaceId: workspace.id, actorId: user.id, action: "retention.changed", detail: { days } });
  revalidatePath("/settings");
  return { notice: `Saved. Raw replies older than ${days} days are removed at the next daily pass (03:17 UTC).` };
}
