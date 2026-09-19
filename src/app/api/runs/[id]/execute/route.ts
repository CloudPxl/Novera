import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { startRunExecution } from "@/lib/workflow/execute-run.ts";

export const dynamic = "force-dynamic";
// A 16-case suite with grading takes well over a minute. On a platform with a
// shorter ceiling this needs chunking; stated here rather than discovered later.
export const maxDuration = 300;

/**
 * Executes a queued run.
 *
 * Kept as a route handler rather than a server action because it is long-running and
 * the page needs to poll progress while it works. Idempotent by status: a run that
 * is not queued is not started again, so a double-submit or a page refresh cannot
 * produce two graders writing the same cases.
 */
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, workspace } = await requireWorkspace();
  const admin = await assertMembership(user.id, workspace.id);

  const { data: run, error } = await admin
    .from("runs")
    .select("id, status, workspace_id")
    .eq("id", id)
    .eq("workspace_id", workspace.id)
    .maybeSingle();

  if (error || !run) return Response.json({ error: "Run not found." }, { status: 404 });
  if (run.status !== "queued") {
    return Response.json({ status: run.status, started: false });
  }

  try {
    const summary = await startRunExecution({ client: admin, workspaceId: workspace.id, runId: id });
    return Response.json({
      status: summary.status,
      started: true,
      passed: summary.coverage.passed,
      failed: summary.coverage.failed,
      errored: summary.coverage.errored,
    });
  } catch (thrown) {
    const message = thrown instanceof Error ? thrown.message : String(thrown);
    await admin.from("runs").update({ status: "aborted", error: message, finished_at: new Date().toISOString() }).eq("id", id);
    return Response.json({ error: message }, { status: 500 });
  }
}
