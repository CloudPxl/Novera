import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { startRunExecution } from "@/lib/workflow/execute-run.ts";

export const dynamic = "force-dynamic";

/**
 * Vercel's Hobby ceiling. A 16-case suite graded by two models does not reliably fit
 * inside it, so the run is executed in bounded slices instead of being chunked by
 * hand: each invocation grades what it can, saves everything it graded, and says
 * whether it finished.
 */
export const maxDuration = 60;

/** Leaves room to publish the report after the last case is graded. */
const BUDGET_MS = 42_000;

/**
 * How long before a run that says "running" is assumed dead.
 *
 * A serverless function is killed at the ceiling with no chance to record anything,
 * so "running" cannot be trusted to mean "something is running". Past this, another
 * invocation may take the run over — and because cases already stored are skipped,
 * taking it over can only add evidence, never duplicate or replace it.
 */
const LEASE_MS = 70_000;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);

  const { data: run, error } = await admin
    .from("runs")
    .select("id, status, started_at")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error || !run) return Response.json({ error: "Run not found." }, { status: 404 });

  if (run.status === "completed" || run.status === "aborted") {
    return Response.json({ status: run.status, started: false, done: true });
  }

  if (run.status === "running") {
    const age = run.started_at ? Date.now() - new Date(run.started_at as string).getTime() : Infinity;
    if (age < LEASE_MS) {
      return Response.json({ status: "running", started: false, done: false });
    }
  }

  // Take the lease before doing any work, so a second caller a moment later sees it.
  await admin
    .from("runs")
    .update({ status: "running", started_at: new Date().toISOString() })
    .eq("id", id);

  try {
    const summary = await startRunExecution({
      client: admin,
      workspaceId: workspace.id,
      runId: id,
      budgetMs: BUDGET_MS,
    });

    return Response.json({
      status: summary.status,
      started: true,
      // False means "call me again", not "something went wrong".
      done: summary.status !== "incomplete",
      graded: summary.cases.length,
      passed: summary.coverage.passed,
      failed: summary.coverage.failed,
      errored: summary.coverage.errored,
    });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    await admin
      .from("runs")
      .update({ status: "aborted", error: message, finished_at: new Date().toISOString() })
      .eq("id", id);
    return Response.json({ error: message }, { status: 500 });
  }
}
