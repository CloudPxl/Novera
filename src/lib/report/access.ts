import "server-only";
import { serviceClient } from "../supabase/service.ts";
import type { ReportPayload } from "./payload.ts";

export interface StoredReport {
  payload: ReportPayload;
  content_hash: string;
  expires_at: string;
  revoked_at: string | null;
  created_at: string;
}

export type ReportAccess = StoredReport | "expired" | "revoked" | null;

/**
 * The single gate in front of a sealed report.
 *
 * Shared by the page a client opens and by every export of it. Two copies of this
 * rule would eventually disagree, and the way they would disagree is an export
 * continuing to serve a report after the link was revoked — which is exactly the
 * promise revocation makes.
 *
 * The token is looked up with the service role because the token *is* the
 * capability: long, random, never indexed, and checked here for expiry and
 * revocation before anything is handed back.
 */
export async function loadReportByToken(token: string): Promise<ReportAccess> {
  const { data, error } = await serviceClient()
    .from("reports")
    .select("payload, content_hash, expires_at, revoked_at, created_at")
    .eq("token", token)
    .maybeSingle();

  if (error || !data) return null;
  if (data.revoked_at) return "revoked";
  if (new Date(data.expires_at) < new Date()) return "expired";
  return data as StoredReport;
}
