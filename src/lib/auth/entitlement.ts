import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../store/secrets.ts";
import { connectionFor, modelsForStoredKey } from "../providers/workspace-connections.ts";
import { DEFAULT_ROUTES, routesForConnection, type RouteTable } from "../router/routes.ts";

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
export const TRIAL_RUN_LIMIT = 3; // also in 0049's runs_trial_cap, which enforces it under concurrency

export const TRIAL_EXHAUSTED = `The trial covers ${TRIAL_RUN_LIMIT} runs and you have used all of them. Connect your own model key to keep running the suite — there is nothing to pay us, the grading simply runs on your key from then on.`;

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
  /** For a workspace on its own key: the models it grades with, in order. */
  judgeModels: string[];
  /** When the key was stored. Null on the trial allowance. */
  keyStoredAt: string | null;
}

export async function workspaceEntitlement(args: {
  client: SupabaseClient;
  workspaceId: string;
}): Promise<Entitlement> {
  const { client, workspaceId } = args;

  const key = await revealSecret({ client, workspaceId, scope: "judge_key" });

  // Counted from stored rows, like every other number in this product. Queued and
  // running rows count too: three runs started in parallel is still three runs. The trial
  // belongs to the owner across every workspace they own (0055), so the count does too.
  const { data: ws } = await client.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  const { data: owned } = ws
    ? await client.from("workspaces").select("id").eq("owner_id", ws.owner_id as string)
    : { data: [{ id: workspaceId }] };
  const { count } = await client
    .from("runs")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", (owned ?? []).map((w) => w.id as string));

  const runsUsed = count ?? 0;

  if (key) {
    // A key that cannot be routed is worse than no key: the workspace is unmetered, so
    // nothing stops it starting runs, and every case in every one of them would come
    // back errored. Refusing here turns that into one sentence on the settings page.
    const models = key.provider ? modelsForStoredKey(key.provider, key.models) : [];
    const routable = Boolean(key.provider && connectionFor(key.provider, key.value)) && models.length > 0;

    return {
      ownKey: true,
      provider: key.provider,
      runsUsed,
      runsAllowed: null,
      canRun: routable,
      blockedReason: routable
        ? null
        // Read on the dashboard, in the run launcher and on Settings itself, so it
        // names no page: "open Settings" is wrong advice on Settings.
        : `The ${key.provider ?? "stored"} key in this workspace has no model recorded to grade with, so nothing can be graded on it. Connect the key again naming a model — it is proved before it is saved.`,
      judgeSource: "workspace_key",
      /** The models this key grades with, in order. Empty only when it cannot grade. */
      judgeModels: models,
      keyStoredAt: key.createdAt,
    };
  }

  const exhausted = runsUsed >= TRIAL_RUN_LIMIT;

  return {
    ownKey: false,
    provider: null,
    runsUsed,
    runsAllowed: TRIAL_RUN_LIMIT,
    canRun: !exhausted,
    blockedReason: exhausted ? TRIAL_EXHAUSTED : null,
    judgeSource: "trial_free",
    judgeModels: [],
    keyStoredAt: null,
  };
}

/**
 * The route a run in this workspace will grade on, without touching the credential.
 *
 * The manifest declares the judge plan *before* the run starts, and it has to be the
 * plan that is actually used: a BYOK run that declared our four-candidate panel and
 * then graded on the customer's single model would put a false declaration in the one
 * document whose entire claim is that the inputs were fixed in advance.
 */
export function plannedRoutes(entitlement: Entitlement): RouteTable {
  if (entitlement.ownKey && entitlement.provider && entitlement.judgeModels.length) {
    return routesForConnection(entitlement.provider, entitlement.judgeModels);
  }
  return DEFAULT_ROUTES;
}
