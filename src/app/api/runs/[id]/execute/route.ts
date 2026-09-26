import { currentWorkspace, assertMembership } from "@/lib/auth/session.ts";
import { advanceRun } from "@/lib/workflow/start-run.ts";

export const dynamic = "force-dynamic";

/**
 * Vercel's Hobby ceiling. A 16-case suite graded by two models does not reliably fit
 * inside it, so the run is executed in bounded slices instead of being chunked by
 * hand: each invocation grades what it can, saves everything it graded, and says
 * whether it finished.
 */
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  // 401 with a body, not a redirect to the sign-in page. `fetch` follows a redirect
  // transparently, so the run page received sign-in HTML with status 200, read it as
  // success, and left the run at "running" indefinitely while saying nothing.
  const session = await currentWorkspace();
  if (!session) {
    return Response.json(
      { error: "Your session has expired. Sign in again and the run will pick up where it stopped." },
      { status: 401 },
    );
  }

  const { user, workspace } = session;
  const admin = await assertMembership(user.id, workspace.id);

  // The same slice, lease and error handling as the API (`start-run.ts`).
  const result = await advanceRun({ client: admin, workspaceId: workspace.id, runId: id });
  if (!result) return Response.json({ error: "Run not found." }, { status: 404 });
  if (result.error) return Response.json({ error: result.error }, { status: 500 });
  return Response.json(result);
}
