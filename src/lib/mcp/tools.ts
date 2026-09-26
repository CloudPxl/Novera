import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getRun, listAgents, listRuns, listSuites } from "../api/read.ts";
import { compareRuns } from "../evidence/compare.ts";
import { loadReportByToken } from "../report/access.ts";
import { contentHash, type Json } from "../report/hash.ts";
import { ToolRefusal, type Tool } from "./protocol.ts";

/**
 * The tools an assistant can call, scoped to the workspace that owns the API key. Every
 * one reads; none starts, changes, approves, publishes or revokes anything. They go
 * through the same read layer as the REST API, so the two cannot disagree.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function uuid(args: Record<string, unknown>, name: string): string {
  const v = args[name];
  if (typeof v !== "string" || !UUID.test(v)) throw new ToolRefusal(`\`${name}\` must be a run id (a UUID). list_runs gives them.`);
  return v;
}

export function buildTools(db: SupabaseClient, workspaceId: string, origin: string): Tool[] {
  const reportLink = (r: { token: string; content_hash: string } | null) =>
    r ? { content_hash: r.content_hash, url: `${origin}/report/${r.token}` } : null;

  const run = async (id: string, responses = false) => {
    const found = await getRun(db, workspaceId, id, { responses });
    if (!found) throw new ToolRefusal("No such run in this workspace.");
    return found;
  };

  return [
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
      description: "One run and every scenario's verdict (pass, fail or no_result), the reason, how it was settled and whether the graders agreed. Set include_responses to also get what each scenario sent and the agent's replies.",
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
}
