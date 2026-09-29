"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, assertMembership } from "@/lib/auth/session.ts";
import type { FormState } from "@/lib/workflow/actions.ts";
import { notifyRunFinished } from "@/lib/webhooks/deliver.ts";

/**
 * Stops a run that has not finished — one waiting for a grading slot, or one nobody
 * needs any more. Its graded scenarios stay as they are; no report is sealed over them
 * (a slice still grading when this lands does not turn it back into a completed run),
 * and the run says who stopped it.
 */
export async function stopRun(_prev: FormState, form: FormData): Promise<FormState> {
  const { user, workspace } = await requireWorkspace();
  const runId = String(form.get("runId") ?? "");
  const admin = await assertMembership(user.id, workspace.id);

  const who = user.email ?? "a member of this workspace";
  const { data, error } = await admin.from("runs")
    .update({
      status: "aborted",
      error: `Stopped by ${who} before it finished. Its graded scenarios are kept; no report was sealed.`,
      finished_at: new Date().toISOString(),
      lease_until: null,
      stopped_by: user.id,
    })
    .eq("id", runId).eq("workspace_id", workspace.id).in("status", ["queued", "running"])
    .select("id");
  if (error) return { error: `The run could not be stopped: ${error.message}` };
  if (!data?.length) return { error: "This run has already finished." };

  await notifyRunFinished(admin, workspace.id, runId, Date.now() + 8_000);
  revalidatePath(`/runs/${runId}`);
  return { notice: "Stopped." };
}
