import { BodyTooLarge, bodyTooLarge, readJsonBody } from "@/lib/api/body.ts";
import { currentWorkspace, gate } from "@/lib/auth/session.ts";
import { checkVerdict, verdictWords } from "@/lib/checks/single.ts";
import { runScenarioCheck } from "@/lib/workflow/scenario-check.ts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Inside this function's 60 s: the check finished and recorded before it. */
const CHECK_BUDGET_MS = 50_000;

/**
 * "Resolve no results", one scenario per call: retests a run case that produced no result
 * through the single-scenario check (`runScenarioCheck`, 0072) — the suite's own case, the
 * run's read-back and production guard, written to `case_retests`, never to the run — and
 * answers with the stored verdict. The run page's panel calls this once per retest-safe
 * scenario, in order, and reads progress from the stored rows.
 *
 * 401 with a body, never a redirect (the run page learned that lesson the hard way).
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<Response> {
  const session = await currentWorkspace();
  if (!session) return Response.json({ ok: false, error: "Your session has expired. Sign in again and press the button once more." }, { status: 401 });
  const { user, workspace } = session;
  const { id } = await params;
  if (!UUID.test(id)) return Response.json({ ok: false, error: "No such run." }, { status: 404 });

  let raw: unknown;
  try {
    raw = await readJsonBody(request, 1024);
  } catch (e) {
    if (e instanceof BodyTooLarge) return bodyTooLarge(1024);
    return Response.json({ ok: false, error: "Send { \"runCaseId\": \"…\" }." }, { status: 400 });
  }
  const runCaseId = typeof (raw as { runCaseId?: unknown } | null)?.runCaseId === "string" ? (raw as { runCaseId: string }).runCaseId : "";
  if (!UUID.test(runCaseId)) return Response.json({ ok: false, error: "No scenario was named." }, { status: 400 });

  const gated = await gate(user.id, workspace.id, "case.retest");
  if ("error" in gated) return Response.json({ ok: false, error: gated.error }, { status: 403 });

  // The case must be this run's, this workspace's, and without a verdict: a scenario that
  // passed or failed is not resolved here (the per-case controls cover it).
  const { data: row } = await gated.admin.from("run_cases").select("id, run_id, workspace_id, status").eq("id", runCaseId).maybeSingle();
  if (!row || row.run_id !== id || row.workspace_id !== workspace.id) return Response.json({ ok: false, error: "No such scenario on this run." }, { status: 404 });
  if (row.status !== "error") return Response.json({ ok: false, error: "This scenario has a verdict; there is nothing to resolve." }, { status: 409 });

  const result = await runScenarioCheck({
    client: gated.admin, workspaceId: workspace.id, target: { kind: "run_case", runCaseId }, userId: user.id, hardStop: Date.now() + CHECK_BUDGET_MS,
  });
  if (!result.ok) {
    return Response.json({ ok: false, code: result.code, error: result.message, ...(result.resetsAt ? { resetsAt: result.resetsAt } : {}) }, { status: result.status });
  }
  const { verdict, noVerdictReason } = checkVerdict(result.check);
  return Response.json({
    ok: true,
    check: {
      id: result.check.id,
      verdict,
      words: verdictWords(verdict, noVerdictReason),
      detail: result.check.rationale ?? result.check.error ?? null,
      createdAt: result.check.created_at,
    },
    remaining: result.rateLimit.remaining,
    resetsAt: result.rateLimit.resetsAt,
  });
}
