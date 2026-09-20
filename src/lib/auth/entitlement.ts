import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../store/secrets.ts";

/**
 * What a workspace is allowed to do, in one place.
 *
 * Two server actions can start a run, and a limit that each checks in its own way is
 * a limit that eventually disagrees with itself. Both ask here.
 *
 * The trial is funded by our own free-tier key, so it is capped. Connecting your own
 * model key removes the cap, because from then on the grading is yours to pay for —
 * that is the whole of the "BYOK to leave trial" rule, and it is deliberately not a
 * payment wall: nothing is charged by us at any point.
 */
export const TRIAL_RUN_LIMIT = 3;

export interface Entitlement {
  /** True once the workspace has supplied its own model key. */
  ownKey: boolean;
  provider: string | null;
  runsUsed: number;
  /** Null means unmetered. */
  runsAllowed: number | null;
  canRun: boolean;
  /** Why not, in words a customer should read. Null when they can run. */
  blockedReason: string | null;
  judgeSource: "trial_free" | "workspace_key";
}

export async function workspaceEntitlement(args: {
  client: SupabaseClient;
  workspaceId: string;
}): Promise<Entitlement> {
  const { client, workspaceId } = args;

  const key = await revealSecret({ client, workspaceId, scope: "judge_key" });

  // Counted from stored rows, like every other number in this product. Queued and
  // running rows count too: three runs started in parallel is still three runs.
  const { count } = await client
    .from("runs")
    .select("id", { count: "exact", head: true })
    .eq("workspace_id", workspaceId);

  const runsUsed = count ?? 0;

  if (key) {
    return {
      ownKey: true,
      provider: key.provider,
      runsUsed,
      runsAllowed: null,
      canRun: true,
      blockedReason: null,
      judgeSource: "workspace_key",
    };
  }

  const exhausted = runsUsed >= TRIAL_RUN_LIMIT;

  return {
    ownKey: false,
    provider: null,
    runsUsed,
    runsAllowed: TRIAL_RUN_LIMIT,
    canRun: !exhausted,
    blockedReason: exhausted
      ? `The trial covers ${TRIAL_RUN_LIMIT} runs and you have used all of them. Connect your own model key to keep running the suite — there is nothing to pay us, the grading simply runs on your key from then on.`
      : null,
    judgeSource: "trial_free",
  };
}
