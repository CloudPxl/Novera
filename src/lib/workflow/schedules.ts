"use server";

import { revalidatePath } from "next/cache";
import { requireWorkspace, gate } from "@/lib/auth/session.ts";
import {
  MAX_ACTIVE_SCHEDULES, describeTiming, formatUtc, nextOccurrence, validTiming,
} from "@/lib/schedules/cadence.ts";

export interface ScheduleFormState {
  error?: string;
  notice?: string;
}

/**
 * Sets up a scheduled re-evaluation. Every lookup is scoped to the caller's workspace,
 * and 0036 refuses a schedule naming another workspace's agent or suite regardless.
 */
export async function createSchedule(_prev: ScheduleFormState, form: FormData): Promise<ScheduleFormState> {
  const { user, workspace } = await requireWorkspace();
  const agentId = String(form.get("agentId") ?? "");
  const suiteId = String(form.get("suiteId") ?? "");
  const cadence = String(form.get("cadence") ?? "");
  const hourUtc = Number(form.get("hourUtc"));
  const weekday = cadence === "weekly" ? Number(form.get("weekday")) : null;
  const timing = { cadence, hourUtc, weekday };
  if (!validTiming(timing)) return { error: "Choose how often, and at what hour." };

  const gated = await gate(user.id, workspace.id, "schedule.write");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const { data: agent } = await admin.from("agents").select("id, archived_at")
    .eq("id", agentId).eq("workspace_id", workspace.id).maybeSingle();
  if (!agent) return { error: "That agent could not be found in this workspace." };
  if (agent.archived_at) return { error: "This agent is archived. Restore it before scheduling runs of it." };

  const { data: policy } = await admin.from("policies").select("id")
    .eq("agent_id", agentId).eq("workspace_id", workspace.id).limit(1).maybeSingle();
  if (!policy) return { error: "Save a policy version first — every scheduled run is graded against it." };

  const { data: suite } = await admin.from("suites").select("id, workspace_id, approval").eq("id", suiteId).maybeSingle();
  if (!suite || suite.approval === "exploratory" || (suite.workspace_id !== null && suite.workspace_id !== workspace.id)) {
    return { error: "Choose a suite this workspace can run." };
  }

  const { count } = await admin.from("run_schedules").select("id", { count: "exact", head: true })
    .eq("workspace_id", workspace.id).is("cancelled_at", null);
  if ((count ?? 0) >= MAX_ACTIVE_SCHEDULES) {
    return { error: `This workspace already has ${MAX_ACTIVE_SCHEDULES} schedules. Cancel one first.` };
  }

  const next = nextOccurrence(timing, new Date());
  const { error } = await admin.from("run_schedules").insert({
    workspace_id: workspace.id,
    agent_id: agentId,
    suite_id: suiteId,
    cadence: timing.cadence,
    hour_utc: timing.hourUtc,
    weekday: timing.weekday,
    next_run_at: next.toISOString(),
    created_by: user.id,
  });
  if (error) return { error: `The schedule could not be saved: ${error.message}` };

  revalidatePath(`/agents/${agentId}`);
  // Quoted as written: lowercasing it printed "07:00 utc", then "mondays".
  return { notice: `Scheduled: ${describeTiming(timing)}. The first run starts ${formatUtc(next)}.` };
}

async function changeSchedule(
  form: FormData,
  change: "pause" | "resume" | "cancel",
): Promise<ScheduleFormState> {
  const { user, workspace } = await requireWorkspace();
  const scheduleId = String(form.get("scheduleId") ?? "");
  const gated = await gate(user.id, workspace.id, "schedule.write");
  if ("error" in gated) return { error: gated.error };
  const admin = gated.admin;

  const { data: s } = await admin.from("run_schedules")
    .select("id, agent_id, cadence, hour_utc, weekday, paused_at, cancelled_at")
    .eq("id", scheduleId).eq("workspace_id", workspace.id).maybeSingle();
  if (!s || s.cancelled_at) return { error: "That schedule was not found, or is already cancelled." };

  const now = new Date();
  let update: Record<string, unknown>;
  let notice: string;
  if (change === "pause") {
    if (s.paused_at) return { notice: "Already paused." };
    update = { paused_at: now.toISOString(), paused_reason: null };
    notice = "Paused. No run starts until you resume it.";
  } else if (change === "resume") {
    if (!s.paused_at) return { notice: "Already running on schedule." };
    // 0063 refuses it too; this is the sentence.
    const { data: agent } = await admin.from("agents").select("archived_at").eq("id", s.agent_id).maybeSingle();
    if (agent?.archived_at) return { error: "This schedule's agent is archived. Restore the agent, then resume the schedule." };
    // From now, not from where it stopped: resuming never fires a missed run at once.
    const next = nextOccurrence({ cadence: s.cadence, hourUtc: s.hour_utc, weekday: s.weekday }, now);
    update = { paused_at: null, paused_reason: null, next_run_at: next.toISOString() };
    notice = `Resumed. The next run starts ${formatUtc(next)}.`;
  } else {
    update = { cancelled_at: now.toISOString(), cancelled_by: user.id };
    notice = "Cancelled. Runs it already started keep naming it.";
  }

  const { error } = await admin.from("run_schedules").update(update)
    .eq("id", scheduleId).eq("workspace_id", workspace.id).is("cancelled_at", null);
  if (error) return { error: `The schedule could not be changed: ${error.message}` };

  revalidatePath(`/agents/${s.agent_id}`);
  return { notice };
}

export async function pauseSchedule(_prev: ScheduleFormState, form: FormData) {
  return changeSchedule(form, "pause");
}
export async function resumeSchedule(_prev: ScheduleFormState, form: FormData) {
  return changeSchedule(form, "resume");
}
export async function cancelSchedule(_prev: ScheduleFormState, form: FormData) {
  return changeSchedule(form, "cancel");
}
