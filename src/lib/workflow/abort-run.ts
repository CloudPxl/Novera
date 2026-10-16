import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { notifyRunFinished } from "../webhooks/deliver.ts";

/**
 * Ends a run that has not finished: aborted, never sealed, its graded scenarios kept, and the
 * person responsible named. The one implementation behind the Stop button (`stopRun`) and a
 * CI trigger cancelling a run its newer commit superseded — so the two cannot disagree about
 * what stopping means. A slice still grading when this lands does not turn the run back into
 * a completed one (0047: its writes name a lease this clears).
 *
 * Returns whether this call stopped it; false when it had already finished or is not in this
 * workspace. The caller has already decided the actor may stop it.
 */
export async function abortUnfinishedRun(args: {
  client: SupabaseClient;
  workspaceId: string;
  runId: string;
  /** The person responsible: who pressed Stop, or who created the key whose trigger superseded it. */
  stoppedBy: string | null;
  /** Why, in a sentence stored on the run and shown on its page. */
  reason: string;
}): Promise<{ stopped: boolean; error?: string }> {
  const { client, workspaceId, runId } = args;
  const { data, error } = await client.from("runs")
    .update({
      status: "aborted",
      error: args.reason,
      finished_at: new Date().toISOString(),
      lease_until: null,
      stopped_by: args.stoppedBy,
    })
    .eq("id", runId).eq("workspace_id", workspaceId).in("status", ["queued", "running"])
    .select("id");
  if (error) return { stopped: false, error: error.message };
  if (!data?.length) return { stopped: false };
  await notifyRunFinished(client, workspaceId, runId, Date.now() + 8_000);
  return { stopped: true };
}
