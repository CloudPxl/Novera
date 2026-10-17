import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { revealSecret } from "../store/secrets.ts";
import { connectionFor, modelsForStoredKey } from "../providers/workspace-connections.ts";
import { DEFAULT_ROUTES, routesForConnection, type RouteTable } from "../router/routes.ts";
import { serviceClient } from "../supabase/service.ts";
import { loadBillingRows } from "../billing/rows.ts";
import { ALLOWANCE_COLUMN } from "../billing/allowance.ts";
import { fundingLine, resolveEntitlement, type BillingEntitlement, type Blocker, type JudgeSource } from "../billing/entitlement.ts";

/**
 * What a workspace is allowed to do, in one place.
 *
 * Every entry point that can start a run — the button, rerun, the API, MCP, a schedule, a
 * Suite Builder scan — goes through `startRun`, which asks here; so do the top bar, the
 * dashboard and Settings, so what they show is what a run start will decide.
 *
 * The decision itself is `resolveEntitlement` (src/lib/billing/entitlement.ts), over stored
 * rows: a manual grant, a subscription, then the trial. Decision D3 (2026-10-12): the trial is
 * the whole free tier — three runs per account owner, on Novera's keys or on the workspace's own
 * key — and after it every run needs a plan or a grant, own key or not. Grading still runs on
 * the workspace's own key whenever it has one: a plan pays for Novera, never for the grading.
 */
export const TRIAL_RUN_LIMIT = 3; // also in 0049's runs_trial_cap, which enforces it under concurrency

export const TRIAL_EXHAUSTED = `The trial covers ${TRIAL_RUN_LIMIT} runs and you have used all of them. Recurring testing needs a plan: Team BYOK grades on your own model key; Agency Pro adds 100 runs a month graded on Novera's keys.`;

export interface Entitlement {
  /** True once the workspace has supplied its own model key. */
  ownKey: boolean;
  provider: string | null;
  /** Runs counted against the trial: every run of every workspace the owner owns (0055), except one aborted before it recorded a scenario (0074). */
  runsUsed: number;
  canRun: boolean;
  /** Why not, in words a customer should read. Null when they can run. */
  blockedReason: string | null;
  /** The kind of block, for the next step offered beside it (src/lib/billing/remedy.ts). */
  blocker: Blocker | null;
  /** What a run started now is stamped with. When nothing funds one, what it would grade on. */
  judgeSource: JudgeSource;
  /** The subscription or grant a run started now names (0067). */
  funding: { subscriptionId: string | null; grantId: string | null };
  /** For a workspace on its own key: the models it grades with, in order. */
  judgeModels: string[];
  /** When the key was stored. Null on the trial allowance. */
  keyStoredAt: string | null;
  /** The whole billing decision: plan, allowance, window, subscription standing. */
  billing: BillingEntitlement;
  /** One line naming what funds runs here, for the top bar and page headers. */
  fundingLine: string;
}

export async function workspaceEntitlement(args: {
  client: SupabaseClient;
  workspaceId: string;
  now?: Date;
}): Promise<Entitlement> {
  const { client, workspaceId } = args;
  const now = args.now ?? new Date();

  const key = await revealSecret({ client, workspaceId, scope: "judge_key" });

  // Counted from stored rows, like every other number in this product. Queued and
  // running rows count too: three runs started in parallel is still three runs. The trial
  // belongs to the owner across every workspace they own (0055), so the count does too.
  // A run aborted before it recorded any scenario does not count (0074, `ALLOWANCE_COLUMN`),
  // exactly as runs_trial_cap counts under its lock.
  const { data: ws } = await client.from("workspaces").select("owner_id").eq("id", workspaceId).maybeSingle();
  const { data: owned } = ws
    ? await client.from("workspaces").select("id").eq("owner_id", ws.owner_id as string)
    : { data: [{ id: workspaceId }] };
  const { count } = await client
    .from("runs")
    .select("id", { count: "exact", head: true })
    .in("workspace_id", (owned ?? []).map((w) => w.id as string))
    .eq(ALLOWANCE_COLUMN, true);
  const runsUsed = count ?? 0;

  // A key that cannot be routed is worse than no key: every case of every run would come back
  // errored. The decision below refuses the run and says what to fix.
  const models = key?.provider ? modelsForStoredKey(key.provider, key.models) : [];
  const routable = Boolean(key?.provider && connectionFor(key.provider, key.value)) && models.length > 0;

  // Billing tables have no client policy (0060): read with the service role, scoped to this
  // workspace, which every caller has already resolved from the person's live membership.
  const rows = await loadBillingRows(serviceClient(), workspaceId, now);
  const billing = resolveEntitlement({
    now,
    graceDays: rows.config.graceDays,
    trialRunsUsed: runsUsed,
    trialLimit: TRIAL_RUN_LIMIT,
    byok: { connected: Boolean(key), routable, provider: key?.provider ?? null },
    byokRequiresPlan: true,
    subscriptions: rows.subscriptions,
    grants: rows.grants,
    runTimes: rows.runTimes,
    managedRunTimes: rows.managedRunTimes,
    totalRuns: rows.totalRuns,
    runsInFlight: rows.runsInFlight,
    runsInWindow: rows.runsInWindow,
  });

  return {
    ownKey: Boolean(key),
    provider: key?.provider ?? null,
    runsUsed,
    canRun: billing.canRun,
    blockedReason: billing.blockedReason,
    blocker: billing.blocker,
    judgeSource: billing.judgeSource ?? (key ? "workspace_key" : "trial_free"),
    funding: billing.funding,
    /** The models this key grades with, in order. Empty only when it cannot grade. */
    judgeModels: models,
    keyStoredAt: key?.createdAt ?? null,
    billing,
    fundingLine: fundingLine(billing, Boolean(key)),
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
