import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactForStorage } from "../redact/store.ts";
import { NOT_DETECTED, REDACTION_POLICY_VERSION } from "../redact/pii.ts";
import { recordModelOperation, workspaceChat, type WorkspaceChat } from "../providers/model-work.ts";
import { gradeObservation, type GradeResult } from "./grade.ts";
import { insightSuite, scenarioOf } from "./suite.ts";
import { LEASE_MS, PACING_MS, waitBeforeNextTurn, type EventAnswer, type WorkerEvent } from "./protocol.ts";
import type { InsightScanRow, ObservationCapture } from "./types.ts";

/**
 * What the server does with each event the browser worker sends about a scan it holds. Every
 * rule that matters is applied here or in the database, whatever the worker did: the lease and
 * its token, the pacing between turns, that the typed prompt is the scenario's input, that a
 * scenario is recorded once, redaction before storage, grading on the workspace's funding, and
 * that a scan is graded only when every declared scenario has an observation (0082).
 *
 * Dependencies are injectable so the handler is tested against a fake database and a fake grader.
 */
export interface EventDeps {
  now?: () => Date;
  chatFor?: (args: { client: SupabaseClient; workspaceId: string }) => Promise<WorkspaceChat | { error: string }>;
  grade?: typeof gradeObservation;
}

/** The row written for one scenario; the database's checks (0082) decide whether it is consistent. */
interface ObservationInsert {
  workspace_id: string;
  scan_id: string;
  scenario_id: string;
  prompt_text: string;
  response_text: string | null;
  redaction: Record<string, unknown>;
  capture: ObservationCapture;
  worker_id: string;
  status: "pass" | "fail" | "error";
  rationale: string | null;
  failed_assertions: string[];
  judge_model: string | null;
  judge_votes: unknown[];
  judge_agreement: "agreed" | "majority" | "unconfirmed" | "unresolved" | null;
  settled_by: "deterministic" | "models" | null;
  error: string | null;
  judge_funding: WorkspaceChat["funding"] | null;
}

const refuse = (status: number, error: string, stop: boolean, retryAfterMs?: number): EventAnswer =>
  ({ ok: false, status, error, stop, ...(retryAfterMs !== undefined ? { retry_after_ms: retryAfterMs } : {}) });

async function finish(db: SupabaseClient, scan: InsightScanRow, token: string, status: "graded" | "error", kind: string | null, detail: string | null): Promise<boolean> {
  const { data, error } = await db.rpc("finish_insight_scan", { scan: scan.id, token, new_status: status, kind, detail });
  if (error) throw new Error(`Could not finish the scan: ${error.message}`);
  return data === true;
}

async function nextScenario(db: SupabaseClient, scan: InsightScanRow): Promise<string | null> {
  const { data, error } = await db.from("insight_observations").select("scenario_id").eq("scan_id", scan.id);
  if (error) throw new Error(`Could not read the scan's observations: ${error.message}`);
  const recorded = new Set((data ?? []).map((r) => (r as { scenario_id: string }).scenario_id));
  return scan.scenario_ids.find((id) => !recorded.has(id)) ?? null;
}

export async function handleWorkerEvent(
  args: { db: SupabaseClient; scanId: string; workerId: string; token: string; event: WorkerEvent },
  deps: EventDeps = {},
): Promise<EventAnswer> {
  const { db, scanId, workerId, token, event } = args;
  const now = deps.now ?? (() => new Date());
  const chatFor = deps.chatFor ?? workspaceChat;
  const grade = deps.grade ?? gradeObservation;

  const { data: found, error: readError } = await db.from("insight_scans").select("*").eq("id", scanId).maybeSingle();
  if (readError) return refuse(500, `Could not read the scan: ${readError.message}`, false);
  const scan = found as InsightScanRow | null;
  if (!scan) return refuse(404, "No such scan.", true);
  if (scan.status === "aborted") return refuse(409, "The scan was aborted by an operator. Close the page and claim the next scan.", true);
  if (scan.status !== "running") return refuse(409, `The scan is ${scan.status}; nothing more is recorded for it.`, true);
  if (scan.lease_token !== token || scan.claimed_by !== workerId) return refuse(401, "This worker does not hold the scan's lease.", true);
  if (scan.lease_until && Date.parse(scan.lease_until) < now().getTime()) {
    return refuse(409, "The lease on this scan has expired; it ends as lease_expired. Claim the next scan.", true);
  }

  switch (event.kind) {
    case "heartbeat": {
      const { data, error } = await db.rpc("touch_insight_lease", { scan: scan.id, token, lease_ms: LEASE_MS });
      if (error) return refuse(500, `Could not extend the lease: ${error.message}`, false);
      if (data !== true) return refuse(409, "The lease could not be extended; the scan is no longer held.", true);
      return { ok: true, next: null, wait_ms: 0 };
    }

    case "page": {
      const page = {
        ...(scan.page ?? {}),
        final_url: event.final_url,
        title: event.title,
        widget: event.widget,
        consent_clicked: event.consent_clicked,
        reported_at: now().toISOString(),
      };
      const { error } = await db.from("insight_scans").update({ page }).eq("id", scan.id).eq("lease_token", token).eq("status", "running");
      if (error) return refuse(500, `Could not record the page: ${error.message}`, false);
      return { ok: true, next: null, wait_ms: 0 };
    }

    case "robots": {
      const robots = {
        ...(scan.robots ?? {}),
        worker: { allowed: event.allowed, crawl_delay_ms: event.crawl_delay_ms, status: event.status, reported_at: now().toISOString() },
      };
      const { error } = await db.from("insight_scans").update({ robots }).eq("id", scan.id).eq("lease_token", token).eq("status", "running");
      if (error) return refuse(500, `Could not record the robots check: ${error.message}`, false);
      return { ok: true, next: null, wait_ms: 0 };
    }

    case "error": {
      const done = await finish(db, scan, token, "error", event.error_kind, event.detail);
      if (!done) return refuse(409, "The scan could not be ended; it is no longer held.", true);
      return { ok: true, next: null, wait_ms: 0 };
    }

    case "turn": {
      if (!scan.scenario_ids.includes(event.scenario_id)) {
        return refuse(422, `Scenario ${event.scenario_id} is not declared by this scan.`, false);
      }
      const suite = insightSuite(scan.suite_key, scan.suite_version);
      const scenario = suite ? scenarioOf(suite, event.scenario_id) : null;
      if (!scenario) return refuse(500, `The scan declares ${scan.suite_key} v${scan.suite_version}, which this deployment does not know.`, true);
      if (event.prompt_text !== scenario.input) {
        // A reply to a different question is not evidence for this scenario. The worker is wrong
        // and nothing it sends next can be trusted for this scan either.
        await finish(db, scan, token, "error", "worker_error", `The worker typed a prompt that differs from scenario ${scenario.id}'s input.`);
        return refuse(422, "The typed prompt differs from the scenario's input; the scan ends.", true);
      }
      const wait = waitBeforeNextTurn(scan.last_turn_at, now());
      if (wait > 0) return refuse(429, `At least ${PACING_MS / 1000} seconds between turns.`, false, wait);

      const { data: existing } = await db.from("insight_observations").select("id").eq("scan_id", scan.id).eq("scenario_id", event.scenario_id).maybeSingle();
      if (existing) {
        const next = await nextScenario(db, scan);
        return refuse(409, `Scenario ${event.scenario_id} is already recorded for this scan${next ? `; next is ${next}` : ""}.`, false);
      }

      // Redact before anything else sees the reply.
      let responseText: string | null = null;
      let redaction: Record<string, unknown>;
      if (event.response_text !== null) {
        const { fields, record } = redactForStorage({ response: event.response_text });
        responseText = fields.response;
        redaction = { ...record };
      } else {
        redaction = { policy_version: REDACTION_POLICY_VERSION, counts: {}, original_hash: null, redacted_hash: null, not_detected: NOT_DETECTED, none: "no reply arrived" };
      }

      let result: GradeResult | { kind: "unavailable"; reason: string };
      let funding: WorkspaceChat["funding"] | null = null;
      let chat: WorkspaceChat | null = null;
      if (responseText === null) {
        result = { kind: "ungraded", reason: "no_reply" };
      } else if (event.capture.partial) {
        result = { kind: "ungraded", reason: "partial" };
      } else {
        const resolved = await chatFor({ client: db, workspaceId: scan.workspace_id });
        if ("error" in resolved) {
          result = { kind: "unavailable", reason: resolved.error };
        } else {
          chat = resolved;
          funding = resolved.funding;
          try {
            result = await grade({ chat: resolved.chat, scenario, responseText, partial: false });
          } catch (e) {
            result = { kind: "unavailable", reason: e instanceof Error ? e.message : "The AI graders could not be reached." };
          }
        }
      }

      const row: ObservationInsert = {
        workspace_id: scan.workspace_id,
        scan_id: scan.id,
        scenario_id: event.scenario_id,
        prompt_text: event.prompt_text,
        response_text: responseText,
        redaction,
        capture: event.capture,
        worker_id: workerId,
        ...(result.kind === "graded"
          ? {
              status: result.status,
              rationale: result.rationale,
              failed_assertions: result.failedAssertions,
              judge_model: result.judgeModel,
              judge_votes: result.judgeVotes,
              judge_agreement: result.judgeAgreement,
              settled_by: result.settledBy,
              error: result.error,
              judge_funding: result.settledBy === "models" ? funding : null,
            }
          : {
              status: "error" as const,
              rationale: null,
              failed_assertions: [],
              judge_model: null,
              judge_votes: [],
              judge_agreement: null,
              settled_by: null,
              error: result.kind === "ungraded"
                ? result.reason === "no_reply"
                  ? "No reply arrived within the wait, so there is nothing to grade."
                  : "The reply had not finished changing when the wait ran out. It is kept as captured and not graded."
                : `The AI graders were not available: ${result.reason}`.slice(0, 1000),
              judge_funding: null,
            }),
      };
      const { error: insertError } = await db.from("insight_observations").insert(row);
      if (insertError) return refuse(500, `The reply was captured but could not be recorded: ${insertError.message}`, false);

      if (chat) {
        try {
          await recordModelOperation(db, {
            workspaceId: scan.workspace_id,
            operation: "insight_grade",
            funding: chat.funding,
            outcome: result.kind === "graded" ? (result.status === "error" ? "no_usable_output" : "ok") : "error",
            calls: chat.calls,
            detail: `insight scan ${scan.id} scenario ${event.scenario_id}`,
          });
        } catch { /* the observation is the evidence; the operation record is a count */ }
      }

      const { error: updateError } = await db.from("insight_scans")
        .update({ last_turn_at: now().toISOString(), turns_recorded: scan.turns_recorded + 1 })
        .eq("id", scan.id).eq("lease_token", token).eq("status", "running");
      if (updateError) return refuse(500, `Recorded, but the scan's progress could not be updated: ${updateError.message}`, false);

      const next = await nextScenario(db, scan);
      if (next === null) {
        const done = await finish(db, scan, token, "graded", null, null);
        if (!done) return refuse(409, "Every scenario is recorded, but the scan could not be marked graded; it is no longer held.", true);
      }
      return { ok: true, next, wait_ms: next ? PACING_MS : 0 };
    }
  }
}
