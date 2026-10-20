import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { serviceClient } from "../supabase/service.ts";
import { INVITE_COOKIE } from "./session.ts";

/**
 * The invitation this browser holds (`holdInvitation`), only while it can still be accepted.
 *
 * The cookie lives seven days and outlived the invitation it named: once revoked, used or expired,
 * the shell kept offering it and every plain sign-in went to a dead invitation page instead of the
 * dashboard (Round 2 audit, 2026-10-19). A page cannot clear a cookie, so a dead one is ignored
 * until it expires; accepting still clears it, and acceptance is still decided in the database.
 */
export async function heldInvitationToken(): Promise<string | null> {
  const token = (await cookies()).get(INVITE_COOKIE)?.value;
  if (!token || !/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data } = await serviceClient().from("workspace_invitations")
    .select("accepted_at, revoked_at, expires_at").eq("token_hash", tokenHash).maybeSingle();
  if (!data || data.accepted_at || data.revoked_at) return null;
  if (data.expires_at && Date.parse(data.expires_at as string) <= Date.now()) return null;
  return token;
}
