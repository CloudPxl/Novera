"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { abortUnfinishedRun } from "@/lib/workflow/abort-run.ts";

/**
 * Stops a run that has not finished — one waiting for a grading slot, or one nobody
 * needs any more. Its graded scenarios stay as they are; no report is sealed over them
 * (a slice still grading when this lands does not turn it back into a completed run),
 * and the run says who stopped it.
 */
export async function stopRun(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const runId = String(form.get("runId") ?? "");
  const gated = await gate(user.id, workspace.id, "run.stop");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const who = user.email ?? "a member of this workspace";
  const result = await abortUnfinishedRun({
    client: admin, workspaceId: workspace.id, runId, stoppedBy: user.id,
    reason: `Stopped by ${who} before it finished. Its graded scenarios are kept; no report was sealed.`,
  });
  if (result.error) return { error: `The run could not be stopped: ${result.error}` };
  if (!result.stopped) return { error: "This run has already finished." };

  revalidatePath(`/runs/${runId}`);
  return { notice: "Stopped." };
}
