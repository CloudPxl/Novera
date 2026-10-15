import "server-only";
import { serviceClient } from "@/lib/supabase/service.ts";
import { buildReceipt, SEAL_COLUMNS, type SealReceipt, type SealRow } from "@/lib/report/public-verify.ts";

/**
 * The public seal check's one database read, by digest, for the four columns the receipt
 * needs. Shared by `/verify/<hash>` and `/api/verify/<hash>`, so the page and the JSON answer
 * can never disclose different things. A failed read is reported as a failed check, never as
 * "no report has this digest": that would be a claim.
 */
export async function lookupSeal(digest: string): Promise<SealReceipt | "unavailable"> {
  try {
    const { data, error } = await serviceClient()
      .from("reports")
      .select(SEAL_COLUMNS)
      .eq("content_hash", digest)
      .order("created_at", { ascending: true })
      .limit(1);
    if (error) return "unavailable";
    return buildReceipt(digest, (data?.[0] as SealRow | undefined) ?? null);
  } catch {
    return "unavailable";
  }
}
