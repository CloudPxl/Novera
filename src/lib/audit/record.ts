import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * One line in the audit trail (0054): who changed who may do what. Membership, roles, keys,
 * webhooks, retention, account mode, memory, erasure.
 *
 * `detail` holds ids, roles and counts — never an email address, a key, a reply or policy
 * text: the trail is read by auditors and kept as long as the workspace is.
 *
 * A failure to record is thrown, not swallowed. The changes that write here are the ones an
 * auditor will ask about; a change that happened without its line is worse than a refusal.
 */
export type AuditAction =
  | "member.invited" | "member.invitation_revoked" | "member.joined" | "member.removed" | "member.left"
  | "member.role_changed" | "workspace.created" | "workspace.renamed" | "workspace.switched" | "workspace.erased"
  | "account.mode_changed" | "account.profile_updated" | "account.exported" | "account.personalization_reset"
  | "account.erased" | "apikey.created" | "apikey.revoked" | "webhook.created" | "webhook.revoked"
  | "retention.changed" | "report.withdrawn" | "judgekey.connected" | "judgekey.removed"
  | "memory.created" | "memory.deleted" | "memory.cleared" | "memory.suggestion_accepted" | "memory.suggestion_dismissed"
  | "suite.bulk_approved" | "suite.published" | "suite.gaps_accepted" | "suite.source_fetched";

export async function recordAudit(admin: SupabaseClient, event: {
  workspaceId: string | null;
  actorId: string;
  subjectUserId?: string | null;
  action: AuditAction;
  detail?: Record<string, unknown>;
}): Promise<void> {
  const { error } = await admin.from("audit_events").insert({
    workspace_id: event.workspaceId,
    actor_id: event.actorId,
    subject_user_id: event.subjectUserId ?? null,
    action: event.action,
    detail: event.detail ?? {},
  });
  if (error) throw new Error(`Could not record this change in the audit trail: ${error.message}`);
}

/** Words for an audit line, for the screen. */
export const AUDIT_LABEL: Record<AuditAction, string> = {
  "member.invited": "invited a member",
  "member.invitation_revoked": "revoked an invitation",
  "member.joined": "joined",
  "member.removed": "removed a member",
  "member.left": "left the workspace",
  "member.role_changed": "changed a member's role",
  "workspace.created": "created the workspace",
  "workspace.renamed": "renamed the workspace",
  "workspace.switched": "switched workspace",
  "workspace.erased": "erased a workspace",
  "account.mode_changed": "changed account mode",
  "account.profile_updated": "updated their profile",
  "account.exported": "exported their data",
  "account.personalization_reset": "reset their personalization",
  "account.erased": "deleted their account",
  "apikey.created": "created an API key",
  "apikey.revoked": "revoked an API key",
  "webhook.created": "added a webhook",
  "webhook.revoked": "revoked a webhook",
  "retention.changed": "changed evidence retention",
  "report.withdrawn": "withdrew a report",
  "judgekey.connected": "connected a model key",
  "judgekey.removed": "removed the model key",
  "memory.created": "saved an assistant memory",
  "memory.deleted": "deleted an assistant memory",
  "memory.cleared": "cleared assistant memory",
  "memory.suggestion_accepted": "accepted a memory suggestion",
  "memory.suggestion_dismissed": "dismissed a memory suggestion",
  "suite.bulk_approved": "approved several scenarios at once",
  "suite.published": "published a suite version",
  "suite.gaps_accepted": "published a suite with open questions",
  "suite.source_fetched": "had a web page fetched as a source",
};
