import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRun, listAgents, listRuns, listSuites } from "../api/read.ts";
import type { Scope } from "../api/keys.ts";
import { compareRuns } from "../evidence/compare.ts";
import { loadReportByToken } from "../report/access.ts";
import { contentHash, type Json } from "../report/hash.ts";
// start-run, propose and the rate limiter are loaded when a tool that needs them is called: a read-only
// key never pays for the runner, and the tool list can be built without it.
import { READ_ONLY_INSTRUCTIONS, ToolRefusal, type Tool, type ToolAnnotations } from "./protocol.ts";

/**
 * The tools an assistant can call, scoped to the workspace that owns the API key and
 * limited to what the key's scopes allow — a tool the key cannot use is not listed.
 *
 *   read   the seven read tools, through the same read layer as the REST API
 *   run    start_run and advance_run: the same startRun/advanceRun as the button
 *   write  draft_scenarios and request_diagnosis: a model proposes, stored as a draft
 *          or a proposal, the same functions as the buttons
 *
 * No scope approves, publishes, revokes, changes a policy or sends anything. Those are
 * a person's decisions in the app, and the write tools answer with the link to make them.
 */

export interface McpCaller {
  workspaceId: string;
  keyId: string;
  scopes: Scope[];
}

/**
 * Drafting and diagnosing call a model on Novera's grading quota, which every workspace
 * shares; this bounds what one workspace's assistants can spend. Counted in Postgres.
 */
export const MODEL_TOOL_LIMIT = { max: 20, windowSeconds: 3600 };

const STARTS_WORK: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true };
const PROPOSES: ToolAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false };

export function instructionsFor(scopes: Scope[]): string {
  if (!scopes.includes("run") && !scopes.includes("write")) return READ_ONLY_INSTRUCTIONS;
  return [
    "Every verdict and count comes from stored runs; a scenario with no result is never a pass.",
    scopes.includes("run")
      ? "This key can start a run (start_run), which spends a trial run or grading on the workspace's own model key, and then advance it (advance_run) until done — say so before you start one."
      : null,
    scopes.includes("write")
      ? "This key can ask for scenario drafts and failure diagnoses. They are proposals: nothing you call can approve one, change a policy, publish or revoke a report, or send anything. Give the person the link each tool returns; they decide in Novera."
      : null,
  ].filter(Boolean).join(" ");
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ID_SOURCE: Record<string, string> = {
  run_id: "a run id (a UUID). list_runs gives them",
  baseline_run_id: "a run id (a UUID). list_runs gives them",
  agent_id: "an agent id (a UUID). list_agents gives them",
  suite_id: "a suite id (a UUID). list_suites gives them",
};

function uuid(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !UUID.test(v)) throw new ToolRefusal(`\`${name}\` must be ${ID_SOURCE[name] ?? "a UUID"}.`);
  return v;
}

export function buildTools(db: SupabaseClient, caller: McpCaller, origin: string): Tool[] {
  const { workspaceId } = caller;
  const reportLink = (r: { token: string; content_hash: string } | null) =>
    r ? { content_hash: r.content_hash, url: `${origin}/report/${r.token}` } : null;

  const run = async (id: string, responses = false) => {
    const found = await getRun(db, workspaceId, id, { responses });
    if (!found) throw new ToolRefusal("No such run in this workspace.");
    return found;
  };

  const tools: Tool[] = [
    {
      name: "list_agents",
      title: "List agents",
      description: "The agents in this workspace: name, host, whether it serves real customers, and its latest policy version.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => ({ agents: await listAgents(db, workspaceId) }),
    },
    {
      name: "list_suites",
      title: "List suites",
      description: "Suite versions this workspace can run — built-in and its own — with how many scenarios each has.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      run: async () => ({ suites: await listSuites(db, workspaceId) }),
    },
    {
      name: "list_runs",
      title: "List runs",
      description: "Recent runs, newest first, with passed / failed / no-result counts computed from stored scenarios and the sealed report's link. A no-result scenario is never a pass.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string", description: "Only runs for this agent." },
          limit: { type: "integer", minimum: 1, maximum: 100, default: 20 },
        },
        additionalProperties: false,
      },
      run: async (args) => {
        const agentId = args.agent_id === undefined ? undefined : uuid(args, "agent_id");
        const limit = args.limit === undefined ? 20 : Number(args.limit);
        if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new ToolRefusal("`limit` must be a whole number from 1 to 100.");
        const runs = await listRuns(db, workspaceId, { agentId, limit });
        return { runs: runs.map((r) => ({ ...r, report: reportLink(r.report) })) };
      },
    },
    {
      name: "get_run",
      title: "Get a run",
      description: "One run and every scenario's verdict (pass, fail or no_result), the reason, how it was settled and whether the graders agreed. A scenario whose verdict has moved before under the same policy version carries `stability`, saying whether the graders or the agent moved. Set include_responses to also get what each scenario sent and the agent's replies.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" }, include_responses: { type: "boolean", default: false } },
        required: ["run_id"],
        additionalProperties: false,
      },
      run: async (args) => {
        const found = await run(uuid(args, "run_id"), args.include_responses === true);
        return { run: { ...found, report: reportLink(found.report) } };
      },
    },
    {
      name: "get_evidence_gaps",
      title: "Where the evidence is missing",
      description: "The scenarios in a run that produced no verdict, lack the evidence they asked for, or whose graders did not corroborate each other — what a reviewer should look at before relying on the run.",
      inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false },
      run: async (args) => {
        const found = await run(uuid(args, "run_id"));
        const gaps = found.cases
          .filter((c) => c.verdict === "no_result" || c.evidence_gap || c.agreement === "unconfirmed" || c.agreement === "unresolved")
          .map((c) => ({
            id: c.id,
            verdict: c.verdict,
            why: c.verdict === "no_result"
              ? (c.error ?? c.evidence_gap ?? "no verdict was produced")
              : c.evidence_gap ?? `graders: ${c.agreement}`,
          }));
        return { run_id: found.id, total: found.cases.length, gaps };
      },
    },
    {
      name: "compare_runs",
      title: "Compare two runs",
      description: "What got fixed, what still fails, what newly broke and what lost its verdict between a baseline run and a later one, scenario by scenario.",
      inputSchema: {
        type: "object",
        properties: { run_id: { type: "string" }, baseline_run_id: { type: "string" } },
        required: ["run_id", "baseline_run_id"],
        additionalProperties: false,
      },
      run: async (args) => {
        const [current, baseline] = await Promise.all([run(uuid(args, "run_id")), run(uuid(args, "baseline_run_id"))]);
        const asCases = (cases: typeof current.cases) =>
          cases.map((c) => ({ caseId: c.id, status: (c.verdict === "no_result" ? "error" : c.verdict) as "pass" | "fail" | "error" }));
        const cmp = compareRuns(asCases(baseline.cases), asCases(current.cases));
        return {
          run_id: current.id,
          baseline_run_id: baseline.id,
          policy_versions: { baseline: baseline.policy_version, current: current.policy_version },
          fixed: cmp.fixed,
          still_failing: cmp.persistentFailures,
          newly_broken: cmp.newFailures,
          lost_verdict: cmp.nowErrored,
          regained_verdict: cmp.errorResolved,
          same_scenarios: cmp.comparable,
          only_in_current: cmp.notInBaseline,
          only_in_baseline: cmp.missingFromCurrent,
        };
      },
    },
    {
      name: "verify_report",
      title: "Verify a sealed report",
      description: "Recomputes a sealed report's SHA-256 from its stored contents and says whether it matches the hash it was sealed with, and whether the link is still live. Takes the report link or its token.",
      inputSchema: { type: "object", properties: { report: { type: "string" } }, required: ["report"], additionalProperties: false },
      run: async (args) => {
        const raw = typeof args.report === "string" ? args.report.trim() : "";
        const token = /\/report\/([A-Za-z0-9_-]{16,})/.exec(raw)?.[1] ?? (/^[A-Za-z0-9_-]{16,}$/.test(raw) ? raw : null);
        if (!token) throw new ToolRefusal("Pass a report link (…/report/<token>) or its token.");
        const found = await loadReportByToken(token);
        if (found === null) throw new ToolRefusal("No such report.");
        if (found === "revoked" || found === "expired") return { verified: false, status: found };
        const recomputed = contentHash(found.payload as unknown as Json);
        return {
          verified: recomputed === found.content_hash,
          status: "live",
          content_hash: found.content_hash,
          recomputed,
          agent: found.payload.subject.agent,
          run_date: found.payload.run.date,
        };
      },
    },
  ];

  if (caller.scopes.includes("run")) tools.push(...runTools(db, caller, origin));
  if (caller.scopes.includes("write")) tools.push(...writeTools(db, caller, origin));
  return tools;
}

/** The person responsible for what a key does is whoever created it (0035, 0039). */
async function keyCreator(db: SupabaseClient, keyId: string): Promise<string | null> {
  const { data } = await db.from("api_keys").select("created_by").eq("id", keyId).single();
  return (data?.created_by as string | null) ?? null;
}

function runTools(db: SupabaseClient, caller: McpCaller, origin: string): Tool[] {
  return [
    {
      name: "start_run",
      title: "Start a run",
      description: "Starts a run of a suite against one of this workspace's agents, with the same checks as the run button: the trial allowance or the workspace's own model key, the production guard, a policy version. It spends a run — confirm with the person first. The run is queued; call advance_run until it says done.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          suite_id: { type: "string", description: "Optional. The newest built-in suite version otherwise." },
          release_id: { type: "string", description: "Optional. The agent release being tested, as the person states it. The report labels it as declared." },
          knowledge_base_revision: { type: "string", description: "Optional. The knowledge-base revision being tested, as the person states it." },
        },
        required: ["agent_id"],
        additionalProperties: false,
      },
      annotations: STARTS_WORK,
      run: async (args) => {
        const agentId = uuid(args, "agent_id");
        const suiteId = args.suite_id === undefined ? null : uuid(args, "suite_id");
        const { cleanDeclared } = await import("../report/manifest.ts");
        const customerDeclared = cleanDeclared({ releaseId: args.release_id, knowledgeBaseRevision: args.knowledge_base_revision });
        if ("error" in customerDeclared) throw new ToolRefusal(customerDeclared.error);
        const { startRun, RunRefusal } = await import("../workflow/start-run.ts");
        try {
          const run = await startRun({
            client: db,
            workspaceId: caller.workspaceId,
            userId: await keyCreator(db, caller.keyId),
            agentId,
            suiteId,
            apiKeyId: caller.keyId,
            customerDeclared,
          });
          return { run_id: run.id, status: "queued", next: "Call advance_run with this run_id until done is true.", url: `${origin}/runs/${run.id}` };
        } catch (e) {
          if (e instanceof RunRefusal) throw new ToolRefusal(e.message);
          throw e;
        }
      },
    },
    {
      name: "advance_run",
      title: "Advance a run",
      description: "Grades the next slice of a run — about 40 seconds of work — and says whether it is done, with the counts so far. Call again until done is true. A call while another is working is refused politely (started: false), never duplicated.",
      inputSchema: { type: "object", properties: { run_id: { type: "string" } }, required: ["run_id"], additionalProperties: false },
      annotations: STARTS_WORK,
      run: async (args) => {
        const { advanceRun } = await import("../workflow/start-run.ts");
        const result = await advanceRun({ client: db, workspaceId: caller.workspaceId, runId: uuid(args, "run_id") });
        if (!result) throw new ToolRefusal("No such run in this workspace.");
        if (result.error) throw new ToolRefusal("The run stopped with an error. get_run shows what happened.");
        return { ...result };
      },
    },
  ];
}

function writeTools(db: SupabaseClient, caller: McpCaller, origin: string): Tool[] {
  const spend = async () => {
    const { rateLimit } = await import("../support/rate-limit.ts");
    // Refused when the count cannot be read: drafting and diagnosing are model calls.
    const limit = await rateLimit(`mcp-model:${caller.workspaceId}`, MODEL_TOOL_LIMIT, { onError: "refuse" });
    if (!limit.counted) throw new ToolRefusal("Novera could not check this workspace's hourly limit just now, so nothing was drafted. Try again in a minute.");
    if (!limit.allowed) {
      throw new ToolRefusal(`This workspace has asked for ${MODEL_TOOL_LIMIT.max} drafts or diagnoses in the last hour. Try again in ${limit.retryAfterMinutes} minute(s), or use the buttons in Novera.`);
    }
  };

  return [
    {
      name: "draft_scenarios",
      title: "Draft scenarios from the policy",
      description: "Asks a model to draft test scenarios from an agent's latest policy version, each quoting the passage it tests. They are stored as drafts: a draft cannot run, and only a person can approve one, in Novera at the returned review_url. Nothing here changes a suite.",
      inputSchema: {
        type: "object",
        properties: {
          agent_id: { type: "string" },
          count: { type: "integer", minimum: 1, maximum: 6, default: 5 },
        },
        required: ["agent_id"],
        additionalProperties: false,
      },
      annotations: PROPOSES,
      run: async (args) => {
        const agentId = uuid(args, "agent_id");
        const count = args.count === undefined ? 5 : Number(args.count);
        if (!Number.isInteger(count) || count < 1 || count > 6) throw new ToolRefusal("`count` must be a whole number from 1 to 6.");
        await spend();
        const { draftScenariosFromPolicy } = await import("../workflow/propose.ts");
        const drafted = await draftScenariosFromPolicy({
          db, workspaceId: caller.workspaceId, agentId, wanted: count,
          by: { userId: await keyCreator(db, caller.keyId), apiKeyId: caller.keyId },
        });
        if (!drafted.ok) throw new ToolRefusal(drafted.error);
        const v = drafted.value;
        return {
          status: "draft",
          policy_version: v.policyVersion,
          drafted_by: v.servedBy,
          drafts: v.drafts.map((d) => ({ draft_id: d.id, scenario_id: d.scenarioId, input: d.input, tests_passage: d.quote, risk: d.riskLevel })),
          discarded: v.refused,
          review_url: `${origin}/scenarios`,
          note: "Drafts are not tests yet. A person approves or rejects each one in Novera; only approved drafts can enter a suite version.",
        };
      },
    },
    {
      name: "request_diagnosis",
      title: "Diagnose a failed scenario",
      description: "Asks a model why one scenario in a run failed and what change to the policy version that run used would have prevented it. Stored as a proposal: nothing changes until a person approves it in Novera at the returned review_url, which then creates a new policy version.",
      inputSchema: {
        type: "object",
        properties: {
          run_id: { type: "string" },
          scenario_id: { type: "string", description: "The scenario's id in that run, e.g. T07 (get_run lists them)." },
        },
        required: ["run_id", "scenario_id"],
        additionalProperties: false,
      },
      annotations: PROPOSES,
      run: async (args) => {
        const runId = uuid(args, "run_id");
        const scenarioId = typeof args.scenario_id === "string" ? args.scenario_id.trim() : "";
        if (!scenarioId || scenarioId.length > 64) throw new ToolRefusal("`scenario_id` must be a scenario id from get_run, e.g. T07.");
        const { data: row } = await db.from("run_cases").select("id")
          .eq("run_id", runId).eq("case_id", scenarioId).eq("workspace_id", caller.workspaceId).maybeSingle();
        if (!row) throw new ToolRefusal("No such scenario in that run in this workspace.");
        await spend();
        const { diagnoseRunCase } = await import("../workflow/propose.ts");
        const proposed = await diagnoseRunCase({
          db, workspaceId: caller.workspaceId, runCaseId: row.id as string,
          by: { userId: await keyCreator(db, caller.keyId), apiKeyId: caller.keyId },
        });
        if (!proposed.ok) throw new ToolRefusal(proposed.error);
        const v = proposed.value;
        return {
          status: "proposed",
          diagnosis_id: v.id,
          run_id: v.runId,
          scenario_id: v.scenarioId,
          analysis: v.analysis,
          replace: v.quotedOld,
          with: v.proposedNew,
          risks: v.risks,
          drafted_by: v.servedBy,
          review_url: `${origin}/runs/${v.runId}`,
          note: "A proposal changes nothing. A person approves or rejects it in Novera; approving creates a new policy version.",
        };
      },
    },
  ];
}
