"use server";

import { revalidatePath } from "next/cache";
import { requireContext, gate } from "@/lib/auth/session.ts";
import { recordAudit } from "@/lib/audit/record.ts";
import { fingerprint, rateLimit } from "@/lib/support/rate-limit.ts";

export interface ExportState {
  error?: string;
  notice?: string;
  /** The one-time download address, for the person who asked. */
  link?: string;
}

const EXPORT_LIMIT = { max: 10, windowSeconds: 60 * 60 };
const MAX_PENDING = 3;

/**
 * Asks for a copy of the active workspace. Writes a `pending` receipt (0061) that expires in 15
 * minutes and returns its download address; the file is built when that address is opened,
 * once, by the same person, while they still manage this workspace
 * (src/app/api/workspace-export/[id]/route.ts).
 */
export async function requestWorkspaceExport(_prev: ExportState, form: FormData): Promise<ExportState> {
  const { user, workspace } = await requireContext();
  const gated = await gate(user.id, workspace.id, "workspace.export");
  if ("error" in gated) return { error: gated.error };
  const includeRaw = form.get("includeRawEvidence") === "on";

  // Refused when the count cannot be read: each request writes a receipt that cannot be deleted.
  const limit = await rateLimit(fingerprint(["workspace-export", user.id]), EXPORT_LIMIT, { onError: "refuse" });
  if (!limit.allowed) {
    return { error: limit.counted ? `That is ${EXPORT_LIMIT.max} exports in an hour. Try again in about ${limit.retryAfterMinutes} minutes.` : "Novera could not check the export limit just now. Try again in a minute." };
  }

  const now = new Date().toISOString();
  // A link nobody opened in time is recorded as expired, not left looking open.
  await gated.admin.from("workspace_exports").update({ status: "expired" })
    .eq("workspace_id", workspace.id).eq("status", "pending").lt("expires_at", now);
  const { count } = await gated.admin.from("workspace_exports").select("*", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).eq("status", "pending");
  if ((count ?? 0) >= MAX_PENDING) return { error: `This workspace has ${MAX_PENDING} export links waiting to be downloaded. Use one, or wait 15 minutes for them to expire.` };

  const { data, error } = await gated.admin.from("workspace_exports")
    .insert({ workspace_id: workspace.id, requested_by: user.id, includes_raw_evidence: includeRaw })
    .select("id").single();
  if (error || !data) return { error: `Could not prepare the export: ${error?.message ?? "no row"}` };
  await recordAudit(gated.admin, { workspaceId: workspace.id, actorId: user.id, action: "workspace.export_requested", detail: { export: data.id, raw_evidence: includeRaw } });

  revalidatePath("/settings");
  return {
    notice: `Ready. The link below works once, for you, for 15 minutes${includeRaw ? ", and includes your agent's raw replies" : ""}.`,
    link: `/api/workspace-export/${data.id as string}`,
  };
}
