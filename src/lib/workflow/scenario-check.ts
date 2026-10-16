import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AgentAdapter, AgentConfig } from "../agents/types.ts";
import { buildAgentAdapter } from "../agents/factory.ts";
import { buildVerifier } from "../evidence/connectors/index.ts";
import { executeCase } from "../runner/execute.ts";
import type { CaseOutcome, Suite, SuiteCase } from "../runner/types.ts";
import { createRoutedChat, type RoutedChat } from "../router/execute.ts";
import { connectionsForWorkspace } from "../providers/workspace-connections.ts";
import { workspaceEntitlement } from "../auth/entitlement.ts";
import type { Blocker, JudgeSource } from "../billing/entitlement.ts";
import { localise } from "../suites/locales.ts";
import { LOCALE_NAMES, type Locale } from "../suites/locale-names.ts";
import { resolveSuiteRef } from "../ci/server.ts";
import { redact } from "../redact/pii.ts";
import { declaredLocalisation } from "./localised-run.ts";
import { CHECK_LIMIT, LIMIT_UNAVAILABLE, limitRefusal, readSlot, type SlotDecision } from "../checks/single.ts";

/**
 * A single-scenario check: one scenario sent to one agent and graded through `executeCase`, the
 * function a run grades with — rules, then the read-back, then the models — so a check and the
 * run that follows it cannot reach different verdicts by different routes.
 *
 * It starts from a stored run case (what "retest" always was: the run's own scenario, in the
 * run's language, against the newest policy) or from a suite's scenario for a given agent (the
 * catalog, `POST /api/v1/probes/single`). Either way it is emphatically not a run. It is stored in
 * `case_retests` (0013, 0072), never in `runs`, `run_cases` or `reports`, so it cannot reach a
 * score, a coverage figure, a baseline comparison, a report, the trial's three runs or a plan's
 * run allowance. A report is always a whole suite against one policy version.
 *
 * What it shares with a run, deliberately:
 *  - funding: the workspace's own model key when it has one, otherwise the trial keys — and only
 *    while something funds the workspace's runs at all (the trial, a plan, a grant). Fair use
 *    (runs in flight, runs per 30 days) counts runs, so it does not refuse a check;
 *  - the production guard: a destructive or fixture-only scenario is refused against a
 *    production agent, in the runner's own sentence, before anything is sent or counted;
 *  - the read-back and the language variants.
 *
 * What it adds: 20 per workspace in any rolling hour, counted in Postgres under a lock (0072).
 */

export type CheckTarget =
  | { kind: "run_case"; runCaseId: string }
  | { kind: "suite_case"; agentId: string; suiteId: string | null; suiteRef: string | null; scenarioId: string; locale: Locale };

export type CheckRefusalCode =
  | "not_found" | "archived" | "no_policy" | "no_locale_variant" | "localisation_changed"
  | "production_guard" | "not_funded" | "rate_limited" | "limit_unavailable" | "not_run" | "not_recorded";

export interface CheckRefusal {
  ok: false;
  code: CheckRefusalCode;
  /** The HTTP status an API caller receives for it. */
  status: number;
  message: string;
  /** For `not_funded`: the kind of block, so the caller can offer its remedy. */
  blocker?: Blocker | null;
  /** For `rate_limited`: when the next check may start. */
  resetsAt?: string;
}

/** A stored check, as `case_retests` holds it. */
export interface StoredCheck {
  id: string;
  origin: "run_case" | "suite_case";
  run_case_id: string | null;
  agent_id: string | null;
  suite_id: string | null;
  case_id: string | null;
  locale: string | null;
  policy_id: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  failed_assertions: string[];
  evidence_gap: string | null;
  settled_by: string | null;
  judge_model: string | null;
  judge_votes: unknown[];
  judge_agreement: string | null;
  latency_ms: number | null;
  error: string | null;
  judge_source: string | null;
  read_back: { status: string; detail: string; connector: string; mode: string } | null;
  response_text: string | null;
  transcript: unknown;
  created_at: string;
}

export interface CheckSuccess {
  ok: true;
  check: StoredCheck;
  policyVersion: number;
  suite: { id: string; key: string; version: number } | null;
  /** The run the scenario came from, for a check started from a run case. */
  runId: string | null;
  rateLimit: { remaining: number; resetsAt: string };
}

export type CheckResult = CheckSuccess | CheckRefusal;

const STORED_COLUMNS =
  "id, origin, run_case_id, agent_id, suite_id, case_id, locale, policy_id, status, rationale, failed_assertions, "
  + "evidence_gap, settled_by, judge_model, judge_votes, judge_agreement, latency_ms, error, judge_source, read_back, "
  + "response_text, transcript, created_at";

interface AgentRow {
  config: unknown;
  verification: unknown;
  is_production: boolean | null;
  archived_at: string | null;
}

/** The parts that reach outside the database, replaceable in a test. */
export interface CheckDeps {
  entitlement(client: SupabaseClient, workspaceId: string): Promise<{
    canRun: boolean; blocker: Blocker | null; blockedReason: string | null; judgeSource: JudgeSource;
  }>;
  takeSlot(client: SupabaseClient, workspaceId: string): Promise<SlotDecision | null>;
  grade(args: {
    client: SupabaseClient; workspaceId: string; agentId: string; agent: AgentRow; testCase: SuiteCase; policy: string; hardStop?: number;
  }): Promise<CaseOutcome>;
}

export const DEFAULT_DEPS: CheckDeps = {
  entitlement: (client, workspaceId) => workspaceEntitlement({ client, workspaceId }),
  async takeSlot(client, workspaceId) {
    try {
      const { data, error } = await client.rpc("take_scenario_check_slot", {
        p_workspace: workspaceId, max_checks: CHECK_LIMIT.max, window_seconds: CHECK_LIMIT.windowSeconds,
      });
      return error ? null : readSlot(data);
    } catch {
      return null;
    }
  },
  async grade({ client, workspaceId, agentId, agent, testCase, policy, hardStop }) {
    const adapter = await buildAgentAdapter({ client, workspaceId, agentId, config: agent.config as AgentConfig });
    const { connections, routes } = await connectionsForWorkspace({ client, workspaceId });
    return executeCase({
      testCase, agent: adapter, policy, judge: createRoutedChat({ connections, routes }),
      verifier: await buildVerifier({ client, workspaceId, agentId, verification: agent.verification }),
      agentIsProduction: agent.is_production !== false,
      hardStop,
    });
  },
};

const refuse = (code: CheckRefusalCode, status: number, message: string, extra: Partial<CheckRefusal> = {}): CheckRefusal =>
  ({ ok: false, code, status, message, ...extra });

const NEVER_SENT: AgentAdapter = {
  probe: () => { throw new Error("not sent"); },
  send: () => { throw new Error("not sent"); },
  acceptsContext: () => { throw new Error("not sent"); },
};
const NEVER_GRADED = (() => { throw new Error("not graded"); }) as unknown as RoutedChat;

/**
 * The runner's production guard, in the runner's own words. Asked of `executeCase` itself with
 * an agent and a judge that refuse to be used, so the sentence can never drift from what a run
 * records for the same scenario. Null when the guard lets the scenario through.
 */
export async function productionGuard(testCase: SuiteCase, agentIsProduction: boolean | null): Promise<string | null> {
  if (!(testCase.destructive || testCase.fixture_only) || agentIsProduction === false) return null;
  try {
    const outcome = await executeCase({ testCase, agent: NEVER_SENT, policy: "", judge: NEVER_GRADED, agentIsProduction: agentIsProduction ?? undefined });
    return outcome.status === "error" && outcome.error ? outcome.error : "This scenario cannot be run against a production agent.";
  } catch {
    return "This scenario cannot be run against a production agent.";
  }
}

interface Resolved {
  agentId: string;
  testCase: SuiteCase;
  runCaseId: string | null;
  runId: string | null;
  suite: { id: string; key: string; version: number } | null;
  locale: Locale;
}

async function resolveTarget(client: SupabaseClient, workspaceId: string, target: CheckTarget): Promise<Resolved | CheckRefusal> {
  if (target.kind === "run_case") {
    const { data: runCase } = await client
      .from("run_cases").select("id, run_id, case_id, category, obligation, severity, input, expected, assertions")
      .eq("id", target.runCaseId).eq("workspace_id", workspaceId).maybeSingle();
    if (!runCase) return refuse("not_found", 404, "That scenario could not be found in this workspace.");
    const { data: run } = await client
      .from("runs").select("agent_id, suite_id, manifest").eq("id", runCase.run_id).eq("workspace_id", workspaceId).maybeSingle();
    if (!run) return refuse("not_found", 404, "The run this scenario belongs to no longer exists.");

    // The scenario comes from the suite version the run used, whole — its rules, its `context`,
    // its earlier turns — in the language the run declared: a check from a run exists to predict
    // the run. The stored row is the fallback only for a suite that no longer carries the case.
    const { data: suiteRow } = await client
      .from("suites").select("id, key, version, cases").eq("id", run.suite_id).maybeSingle();
    const localisation = declaredLocalisation(run.manifest, Array.isArray(suiteRow?.cases) ? (suiteRow.cases as Suite["cases"]) : []);
    if (!localisation.ok) return refuse("localisation_changed", 409, localisation.error);
    const fromSuite = localisation.cases.find((c) => c.id === runCase.case_id);
    const testCase: SuiteCase = fromSuite ?? {
      id: runCase.case_id as string,
      category: runCase.category as string,
      obligation: runCase.obligation as string,
      severity: runCase.severity as string,
      input: runCase.input as string,
      expected_behavior: runCase.expected as string,
      assertions: Array.isArray(runCase.assertions) ? (runCase.assertions as string[]) : [],
    };
    return {
      agentId: run.agent_id as string,
      testCase,
      runCaseId: runCase.id as string,
      runId: runCase.run_id as string,
      suite: suiteRow ? { id: suiteRow.id as string, key: suiteRow.key as string, version: suiteRow.version as number } : null,
      locale: (localisation.locale ?? "en") as Locale,
    };
  }

  // A suite scenario: the workspace's own suite or a built-in one, never an exploratory scan.
  const suiteId = target.suiteId ?? (target.suiteRef ? await resolveSuiteRef(client, workspaceId, target.suiteRef) : null);
  const { data: suite } = suiteId
    ? await client.from("suites").select("id, key, version, cases, workspace_id, approval").eq("id", suiteId).maybeSingle()
    : { data: null };
  if (!suite || (suite.workspace_id !== null && suite.workspace_id !== workspaceId) || suite.approval === "exploratory") {
    return refuse("not_found", 404, "No such suite in this workspace. GET /api/v1/suites lists them.");
  }
  const cases = Array.isArray(suite.cases) ? (suite.cases as SuiteCase[]) : [];
  const base = cases.find((c) => c.id === target.scenarioId);
  if (!base) {
    return refuse("not_found", 404, `${suite.key} v${suite.version} has no scenario ${target.scenarioId}.`);
  }
  let testCase = base;
  if (target.locale !== "en") {
    // One scenario asked for in one language: sending it in English instead would be a
    // different test under the same name, so a scenario without that variant is refused.
    const localised = localise([base], target.locale);
    if (!localised.localisedIds.includes(base.id)) {
      return refuse("no_locale_variant", 422,
        `Scenario ${base.id} has no ${LOCALE_NAMES[target.locale]} variant. Send it in English, or choose a scenario that has one.`);
    }
    testCase = localised.cases[0];
  }
  return {
    agentId: target.agentId,
    testCase,
    runCaseId: null,
    runId: null,
    suite: { id: suite.id as string, key: suite.key as string, version: suite.version as number },
    locale: target.locale,
  };
}

export async function runScenarioCheck(
  args: {
    client: SupabaseClient;
    workspaceId: string;
    target: CheckTarget;
    /** The person responsible: the one who pressed the button, or the creator of the API key. */
    userId: string | null;
    apiKeyId?: string | null;
    /** True only when an API key with the `responses` scope asked for the reply in the answer. */
    returnsResponses?: boolean;
    /** Epoch ms by which the check must be finished, inside the function's own limit. */
    hardStop?: number;
  },
  deps: CheckDeps = DEFAULT_DEPS,
): Promise<CheckResult> {
  const { client, workspaceId } = args;

  const resolved = await resolveTarget(client, workspaceId, args.target);
  if ("code" in resolved) return resolved;
  const target = resolved;

  const { data: agent } = await client
    .from("agents").select("config, verification, is_production, archived_at")
    .eq("id", target.agentId).eq("workspace_id", workspaceId).maybeSingle<AgentRow>();
  if (!agent) return refuse("not_found", 404, "No such agent in this workspace. GET /api/v1/agents lists them.");
  if (agent.archived_at) {
    return refuse("archived", 409, "This agent is archived, so nothing more is sent to it. Restore it to check a scenario.");
  }

  // The newest policy, not the one a run was graded under: "does it pass now?" is the question.
  const { data: policy } = await client
    .from("policies").select("id, version, body").eq("agent_id", target.agentId).eq("workspace_id", workspaceId)
    .order("version", { ascending: false }).limit(1).maybeSingle();
  if (!policy) return refuse("no_policy", 409, "This agent has no policy version to test against. Add one first.");

  // Refused before anything is counted or sent, in the runner's own sentence.
  const guard = await productionGuard(target.testCase, agent.is_production);
  if (guard) return refuse("production_guard", 409, guard);

  const entitlement = await deps.entitlement(client, workspaceId);
  if (!entitlement.canRun && entitlement.blocker !== "concurrency" && entitlement.blocker !== "fair_use") {
    return refuse("not_funded", 409, entitlement.blockedReason ?? "This workspace cannot run scenarios.", { blocker: entitlement.blocker });
  }

  const slot = await deps.takeSlot(client, workspaceId);
  if (!slot) return refuse("limit_unavailable", 503, LIMIT_UNAVAILABLE);
  if (!slot.allowed) return refuse("rate_limited", 429, limitRefusal(slot.resetsAt), { resetsAt: slot.resetsAt });

  let outcome: CaseOutcome;
  try {
    outcome = await deps.grade({
      client, workspaceId, agentId: target.agentId, agent, testCase: target.testCase, policy: policy.body as string, hardStop: args.hardStop,
    });
  } catch (e) {
    return refuse("not_run", 500, e instanceof Error ? e.message : "The scenario could not be run.");
  }

  const observation = outcome.observation;
  const { data: stored, error } = await client
    .from("case_retests")
    .insert({
      workspace_id: workspaceId,
      origin: target.runCaseId ? "run_case" : "suite_case",
      run_case_id: target.runCaseId,
      agent_id: target.agentId,
      suite_id: target.suite?.id ?? null,
      case_id: target.testCase.id,
      locale: target.locale,
      policy_id: policy.id,
      response_text: outcome.responseText,
      transcript: outcome.transcript ?? null,
      status: outcome.status,
      rationale: outcome.rationale,
      failed_assertions: outcome.failedAssertions,
      evidence_gap: outcome.evidenceGap,
      settled_by: outcome.settledBy,
      judge_model: outcome.judgeModel,
      judge_votes: outcome.judgeVotes,
      judge_agreement: outcome.judgeAgreement,
      latency_ms: outcome.latencyMs,
      error: outcome.error,
      judge_source: entitlement.judgeSource,
      read_back: observation
        ? { status: observation.status, detail: redact(observation.detail).text, connector: observation.connector, mode: observation.mode }
        : null,
      api_key_id: args.apiKeyId ?? null,
      responses_returned: Boolean(args.returnsResponses && args.apiKeyId),
      created_by: args.userId,
    })
    .select(STORED_COLUMNS)
    .single();
  if (error || !stored) {
    return refuse("not_recorded", 500, `The scenario ran but its result could not be recorded${error ? `: ${error.message}` : "."}`);
  }

  return {
    ok: true,
    check: stored as unknown as StoredCheck,
    policyVersion: policy.version as number,
    suite: target.suite,
    runId: target.runId,
    rateLimit: { remaining: slot.remaining, resetsAt: slot.resetsAt },
  };
}
