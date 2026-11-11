import "server-only";
import { serviceClient } from "../supabase/service.ts";

/**
 * The digests of later, unwithdrawn reports that complete this one (0083), for a line on its page
 * beside the sealed content — never inside it, so the original's digest never changes. Only the
 * digest is returned: the reader checks it at /verify, and no other report's link is handed out.
 */
export async function completedBy(contentHash: string): Promise<string[]> {
  try {
    const { data } = await serviceClient()
      .from("reports").select("content_hash").eq("payload->completion->>of", contentHash).is("revoked_at", null)
      .order("created_at", { ascending: true }).limit(5);
    return (data ?? []).map((r) => r.content_hash as string);
  } catch {
    return [];
  }
}
