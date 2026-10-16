"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import { remedyFor } from "@/lib/billing/remedy.ts";
import { isLocale } from "@/lib/suites/locale-names.ts";
import { checkVerdict } from "@/lib/checks/single.ts";
import type { ScenarioCheckState } from "@/lib/checks/state.ts";
import { runScenarioCheck, type CheckTarget } from "./scenario-check.ts";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SCENARIO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
/** Inside a server action's 60 s: finished, and recorded, before this. */
const CHECK_BUDGET_MS = 50_000;

/**
 * "Try this scenario alone": one scenario against the agent's newest policy, from a run case
 * (`runCaseId`) or from a suite (`agentId`, `suiteId`, `scenarioId`, optional `locale`).
 *
 * The same role as a retest always needed (`case.retest`), the same function as the API
 * (`runScenarioCheck`), and the same answer: a check, never a run.
 */
export async function checkScenarioAlone(_prev: ScenarioCheckState, form: FormData): Promise<ScenarioCheckState> {
  const { user, workspace } = await requireWorkspace();

  const runCaseId = String(form.get("runCaseId") ?? "").trim();
  let target: CheckTarget;
  if (runCaseId) {
    if (!UUID.test(runCaseId)) return { error: "No scenario was named." };
    target = { kind: "run_case", runCaseId };
  } else {
    const agentId = String(form.get("agentId") ?? "").trim();
    const suiteId = String(form.get("suiteId") ?? "").trim();
    const scenarioId = String(form.get("scenarioId") ?? "").trim();
    const locale = String(form.get("locale") ?? "").trim() || "en";
    if (!UUID.test(agentId)) return { error: "Choose an agent to send this scenario to." };
    if (!UUID.test(suiteId) || !SCENARIO_ID.test(scenarioId)) return { error: "No scenario was named." };
    if (!isLocale(locale)) return { error: "Choose a language Novera sends scenarios in." };
    target = { kind: "suite_case", agentId, suiteId, suiteRef: null, scenarioId, locale };
  }

  const gated = await gate(user.id, workspace.id, "case.retest");
  if ("error" in gated) return { error: gated.error };

  const result = await runScenarioCheck({
    client: gated.admin, workspaceId: workspace.id, target, userId: user.id, hardStop: Date.now() + CHECK_BUDGET_MS,
  });
  if (!result.ok) {
    const remedy = result.code === "not_funded" ? remedyFor(result.blocker ?? null) : null;
    return { error: result.message, code: result.code, ...(remedy ? { remedy } : {}) };
  }

  if (result.runId) revalidatePath(`/runs/${result.runId}`);
  const { verdict, noVerdictReason } = checkVerdict(result.check);
  return {
    check: {
      id: result.check.id,
      verdict,
      noVerdictReason,
      settledBy: result.check.settled_by,
      reasons: [result.check.rationale, result.check.error].filter((r): r is string => Boolean(r)),
      failedAssertions: Array.isArray(result.check.failed_assertions) ? result.check.failed_assertions.map(String) : [],
      readBack: result.check.read_back ? { status: result.check.read_back.status, detail: result.check.read_back.detail } : null,
      policyVersion: result.policyVersion,
      scenarioId: result.check.case_id,
      createdAt: result.check.created_at,
    },
    remaining: result.rateLimit.remaining,
  };
}
