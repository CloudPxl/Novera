/**
 * A scenario with no verdict, diagnosed: what was observed, what that most likely means,
 * what is not known, and who does what next — computed from the stored rows and nothing else.
 *
 * `repairFor` (./repair.ts) already decides *why* there is no verdict, one of twenty typed
 * reasons. This module sorts those reasons into seven categories a person can act on, and
 * lays the evidence out so an observation is never mistaken for a guess:
 *
 *   - `observedFacts` holds only what a stored field says: times, the HTTP status the runner
 *     recorded, the latency it measured, each grader request the router made or declined.
 *   - `likelyCause` is the interpretation, with how sure it is and which stored field it rests
 *     on. A reason read from a typed field (an attempt's reason, the evidence gap, the judges'
 *     agreement) is HIGH; one read from the runner's own fixed sentence is MEDIUM; an error
 *     Novera never classified is LOW and says "not determined" rather than guessing.
 *   - `knownUnknowns` says what the stored rows cannot tell, for this reason.
 *   - `noveraAction` says only what Novera did. Nothing here pages anyone: no alert exists for
 *     a case without a verdict, so none is claimed.
 *
 * No category is a pass and none becomes one: a diagnosis sits beside a case that stays
 * "no result", counted apart from passes and failures, as everywhere else.
 */
import { vendorOf } from "../judge/independence.ts";
import type { NoVerdictRow, Repair, RepairReason } from "./repair.ts";

export type NoResultCategory =
  | "NOT_RUN"
  | "COULD_NOT_COMPLETE"
  | "RESULT_UNAVAILABLE"
  | "INCONCLUSIVE"
  | "BLOCKED_CONFIG"
  | "BLOCKED_NOVERA"
  | "WITHDRAWN_EXPIRED";

export interface CategoryInfo {
  /** The name a person reads. */
  name: string;
  /** What the category means, in one sentence. */
  meaning: string;
  /** The safe next action, in one sentence. */
  next: string;
}

export const CATEGORIES: Readonly<Record<NoResultCategory, CategoryInfo>> = {
  NOT_RUN: {
    name: "Not run",
    meaning: "Novera held the scenario back before sending it, because the agent's setup could not carry it safely or at all.",
    next: "Change the agent's setup as the scenario says, then retest. The agent never received it.",
  },
  COULD_NOT_COMPLETE: {
    name: "Could not complete",
    meaning: "The scenario was sent, and the exchange with the agent did not finish: no complete reply arrived.",
    next: "Check the agent's endpoint is up and answers within its timeout, then retest once.",
  },
  RESULT_UNAVAILABLE: {
    name: "Result unavailable",
    meaning: "The agent answered, and the answer could not be read as a reply to grade.",
    next: "Check what the endpoint returns for this message against the agent's response settings, then retest.",
  },
  INCONCLUSIVE: {
    name: "Inconclusive",
    meaning: "The evidence did not settle the scenario: the AI graders disagreed and nothing could settle it, or a claimed action could not be checked.",
    next: "Read the reply and the graders' votes yourself; record a finding, or make the expected behaviour or read-back precise, then retest.",
  },
  BLOCKED_CONFIG: {
    name: "Blocked by configuration",
    meaning: "A setting stopped the scenario from producing a verdict: the agent's address, its response path, its credentials, or your own grading key.",
    next: "Fix the setting named below, then retest. Retesting before that gives the same answer.",
  },
  BLOCKED_NOVERA: {
    name: "Blocked on Novera's side",
    meaning: "The agent replied, and Novera could not grade the reply: its AI graders were rate-limited, slow or unreachable, or the run's time slice ended.",
    next: "Retest this scenario; nothing about your agent needs to change.",
  },
  WITHDRAWN_EXPIRED: {
    name: "Withdrawn or expired",
    meaning: "The report was withdrawn by the workspace, or its link has expired. The evidence stays stored and append-only.",
    next: "Run the suite again for a current report.",
  },
};

/** Which part of the scenario's path was reached when the verdict became impossible. */
export type DiagnosticStage = "initialization" | "target_invocation" | "read_back_verification" | "grader_consensus";

export type GraderAttemptStatus = "answered" | "unreadable" | "timed_out" | "rate_limited" | "error" | "not_asked";

export interface GraderAttempt {
  model: string;
  /** The vendor behind the model; two connections to one vendor are one vendor. */
  provider: string;
  status: GraderAttemptStatus;
  /** Why it was not answered or not asked, as the router recorded it. */
  reason: string | null;
  ms: number | null;
}

export interface DiagnosticReport {
  /** `${runId}:${caseRowId}`: one diagnosis per stored case row. */
  id: string;
  runId: string;
  /** The scenario's id in its suite (e.g. T36). */
  scenarioId: string;
  category: NoResultCategory;
  /** The existing reason, kept so a filter or an export can be specific. */
  reason: RepairReason;
  headline: string;
  observedFacts: {
    /** When the run started; null when it was never recorded. */
    startedAt: string | null;
    /** When this scenario's row was recorded. */
    recordedAt: string | null;
    stageReached: DiagnosticStage;
    /** The HTTP status the runner recorded from the agent, when it recorded one. */
    httpStatus: number | null;
    /** How long the agent took, as measured by the runner; null when not measured. */
    latencyMs: number | null;
    /** The agent timeout in force for this agent. */
    configuredTimeoutMs: number;
    /** The agent's address with its path and query hidden. Null when not known. */
    targetUrlMasked: string | null;
    /** Whether the agent received the scenario: yes, no, or not known. */
    agentReceived: Repair["agentReceived"];
    /** Retests already recorded for this scenario in this run. */
    retestsRecorded: number;
    gradersAttempted: GraderAttempt[];
    /** A SHA-256 of the agent's reply is stored for this scenario. */
    replyFingerprintStored: boolean;
    /** The run's report is sealed (a SHA-256 over its content exists). */
    reportSealed: boolean;
    /** The error Novera stored, as stored; null when none. */
    storedError: string | null;
  };
  knownUnknowns: string[];
  likelyCause: {
    hypothesis: string;
    confidence: "high" | "medium" | "low";
    /** The stored field the hypothesis rests on. */
    supportingEvidence: string;
  };
  userAction: {
    required: boolean;
    urgency: "immediate" | "optional" | "none";
    steps: string[];
    /** Who acts: the existing owner wording. */
    owner: Repair["owner"];
  };
  noveraAction: {
    /** Novera tried another grader for this scenario on its own. */
    automatedResolutionAttempted: boolean;
    details: string;
  };
  retryPolicy: {
    isSafeToRetry: boolean;
    /** How long to wait before a retest helps; 0 when waiting changes nothing. */
    recommendedDelayMs: number;
    /** Why a retest should wait, or will not help, when it should or will not. */
    reasonIfBlocked: string | null;
  };
  technicalContext: {
    runId: string;
    caseRowId: string;
    /** The typed reason, for support and for search. */
    errorClass: RepairReason;
    documentationUrl: string;
  };
}

/** Where the categories are explained for customers. */
export const DIAGNOSTICS_DOC = "/docs/reading-a-report#when-a-scenario-has-no-result";

const NOVERA_GRADER_REASONS: ReadonlySet<RepairReason> = new Set([
  "graders_rate_limited", "graders_timed_out", "graders_unreadable", "graders_unavailable",
]);

/**
 * The category for a reason. Grading failures belong to whoever funded the grading: on
 * Novera's keys they are Novera's; on the workspace's own key they are that key's limits or
 * reachability, which only the workspace can change.
 */
export function categoryFor(reason: RepairReason, grading: { ownKey: boolean } = { ownKey: false }): NoResultCategory {
  switch (reason) {
    case "production_guard":
    case "no_metadata_slot":
    case "no_conversation_slot":
      return "NOT_RUN";
    case "agent_timeout":
    case "agent_unreachable":
      return "COULD_NOT_COMPLETE";
    case "agent_too_large":
    case "agent_malformed":
    case "agent_http_error":
    case "unclassified":
      return "RESULT_UNAVAILABLE";
    case "unsettled_disagreement":
    case "action_not_verified":
    case "readback_unavailable":
      return "INCONCLUSIVE";
    case "not_sent_address":
    case "agent_response_path":
    case "graders_refused_data_class":
      return "BLOCKED_CONFIG";
    case "cut_by_slice":
      return "BLOCKED_NOVERA";
    default:
      return NOVERA_GRADER_REASONS.has(reason) ? (grading.ownKey ? "BLOCKED_CONFIG" : "BLOCKED_NOVERA") : "RESULT_UNAVAILABLE";
  }
}

/** A report's own state, when it is no longer current evidence; null while it is. */
export function reportCategory(report: { withdrawnAt: string | null; expiresAt: string | null }, now: Date = new Date()): NoResultCategory | null {
  if (report.withdrawnAt) return "WITHDRAWN_EXPIRED";
  if (report.expiresAt && Date.parse(report.expiresAt) <= now.getTime()) return "WITHDRAWN_EXPIRED";
  return null;
}

/** Scheme and host only: a path can carry a token or a customer's tenant name, a query more so. */
export function maskTargetUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    const path = u.pathname && u.pathname !== "/" ? "/…" : "";
    return `${u.protocol}//${u.host}${path}`;
  } catch {
    return null;
  }
}

function graderStatus(a: { ok?: unknown; reason?: unknown }): GraderAttemptStatus {
  const reason = typeof a.reason === "string" ? a.reason : null;
  if (a.ok === true) return reason === "invalid_output" ? "unreadable" : "answered";
  switch (reason) {
    case "invalid_output": return "unreadable";
    case "timed_out": return "timed_out";
    case "rate_limited": return "rate_limited";
    case "refused_data_class": case "no_credential": case "out_of_time": case "skipped_open_circuit": case "paced": case "budget_spent":
      return "not_asked";
    default: return "error";
  }
}

export function gradersAttempted(attempts: unknown): GraderAttempt[] {
  if (!Array.isArray(attempts)) return [];
  return attempts.map((raw) => {
    const a = (raw ?? {}) as { connection?: unknown; model?: unknown; ok?: unknown; reason?: unknown; ms?: unknown };
    const connection = typeof a.connection === "string" ? a.connection : "unknown";
    const model = typeof a.model === "string" ? `${connection}/${a.model}` : connection;
    return {
      model,
      provider: vendorOf(connection),
      status: graderStatus(a),
      reason: typeof a.reason === "string" ? a.reason : null,
      ms: typeof a.ms === "number" && Number.isFinite(a.ms) ? a.ms : null,
    };
  });
}

const STAGE: Readonly<Record<NoResultCategory, DiagnosticStage>> = {
  NOT_RUN: "initialization",
  COULD_NOT_COMPLETE: "target_invocation",
  RESULT_UNAVAILABLE: "target_invocation",
  INCONCLUSIVE: "grader_consensus",
  BLOCKED_CONFIG: "target_invocation",
  BLOCKED_NOVERA: "grader_consensus",
  WITHDRAWN_EXPIRED: "grader_consensus",
};

function stageFor(reason: RepairReason, category: NoResultCategory, replied: boolean): DiagnosticStage {
  if (reason === "readback_unavailable" || reason === "action_not_verified") return "read_back_verification";
  if (reason === "graders_refused_data_class" || NOVERA_GRADER_REASONS.has(reason)) return "grader_consensus";
  if (reason === "unclassified") return "grader_consensus";
  if (reason === "cut_by_slice") return replied ? "grader_consensus" : "target_invocation";
  return STAGE[category];
}

/** What the stored rows cannot tell, per reason. Each is a boundary, not a guess. */
function unknownsFor(reason: RepairReason, replied: boolean): string[] {
  const acted = "Whether the agent took any action in your systems while handling it: Novera sees only what the agent reports and what a read-back confirms.";
  switch (reason) {
    case "agent_timeout":
      return ["Whether the agent finished the work after Novera stopped waiting.", "Whether the delay was in the agent itself, a model it calls, or a proxy in front of it.", acted];
    case "agent_unreachable":
      return ["Whether the request reached the agent at all.", "Whether the cause was the agent, its host, or the network between.", acted];
    case "agent_http_error":
      return ["What the agent's own logs say about this request: Novera keeps only the status, never the error body."];
    case "agent_malformed":
    case "agent_too_large":
    case "agent_response_path":
      return ["Whether the agent behaved correctly underneath: its answer could not be read, so it was not judged."];
    case "unsettled_disagreement":
      return ["Which grader was right: a split that no third vendor settled stays without a verdict on purpose."];
    case "readback_unavailable":
    case "action_not_verified":
      return ["Whether the action the agent described actually happened in your system.", acted];
    case "graders_rate_limited":
    case "graders_timed_out":
    case "graders_unavailable":
    case "graders_unreadable":
    case "graders_refused_data_class":
      return ["How the reply would have been graded: no AI grader returned a verdict on it."];
    case "cut_by_slice":
      return [replied ? "How the reply would have been graded: the run's time ran out before a grader answered." : "How the agent would have answered: the scenario was not completed in this run's time."];
    case "production_guard":
    case "no_metadata_slot":
    case "no_conversation_slot":
    case "not_sent_address":
      return ["How the agent would have answered: it never received the scenario."];
    default:
      return ["Why no verdict was recorded: the stored error is not one Novera classifies, so no cause is claimed."];
  }
}

function confidenceFor(reason: RepairReason, row: NoVerdictRow): { confidence: "high" | "medium" | "low"; supportingEvidence: string } {
  if (reason === "unclassified") return { confidence: "low", supportingEvidence: "Only the stored error text; it matches none of the runner's fixed sentences." };
  if (reason === "unsettled_disagreement") return { confidence: "high", supportingEvidence: "The graders' stored agreement is \"unresolved\"." };
  if (reason === "readback_unavailable" || reason === "action_not_verified") {
    return { confidence: "high", supportingEvidence: row.observationStatus ? `The read-back observation is stored as "${row.observationStatus}".` : `The stored evidence gap is "${row.evidenceGap ?? "none"}".` };
  }
  if (reason === "graders_refused_data_class" || NOVERA_GRADER_REASONS.has(reason)) {
    const failed = row.judgeAttempts.filter((a) => a.ok !== true || a.reason === "invalid_output").length;
    return failed > 0
      ? { confidence: "high", supportingEvidence: `${failed} stored grader request${failed === 1 ? "" : "s"} with a typed reason.` }
      : { confidence: "medium", supportingEvidence: "The stored error names the graders; no typed request reasons were stored with it." };
  }
  if (reason === "cut_by_slice") {
    return { confidence: "high", supportingEvidence: "Novera's runner recorded that the run's time slice ended before this scenario was finished." };
  }
  if (["production_guard", "no_metadata_slot", "no_conversation_slot", "not_sent_address"].includes(reason)) {
    return { confidence: "high", supportingEvidence: "Novera's own runner wrote this outcome with a fixed sentence when it held the scenario back." };
  }
  return { confidence: "medium", supportingEvidence: "The runner's recorded error for the agent's answer (status, size or format)." };
}

function delayFor(reason: RepairReason): number {
  if (reason === "graders_rate_limited") return 60_000;
  if (reason === "agent_unreachable" || reason === "graders_unavailable") return 30_000;
  return 0;
}

export interface DiagnoseInput {
  runId: string;
  caseRowId: string;
  scenarioId: string;
  row: NoVerdictRow;
  repair: Repair;
  /** The workspace graded on its own model key (the run's judge source). */
  ownKey: boolean;
  runStartedAt: string | null;
  recordedAt: string | null;
  latencyMs: number | null;
  agentUrl: string | null;
  agentTimeoutMs: number;
  retestsRecorded: number;
  replyFingerprintStored: boolean;
  reportSealed: boolean;
}

export function diagnose(input: DiagnoseInput): DiagnosticReport {
  const { repair, row } = input;
  const http = row.error ? /HTTP (\d{3})/.exec(row.error) : null;
  // A redirect means the endpoint's address is wrong, and 401/403 means its credential is: both
  // are settings, which the bare reason ("the agent answered HTTP n") cannot tell apart.
  const status = http ? Number(http[1]) : null;
  const category = repair.reason === "agent_http_error" && status !== null && ((status >= 300 && status < 400) || status === 401 || status === 403)
    ? "BLOCKED_CONFIG"
    : categoryFor(repair.reason, { ownKey: input.ownKey });
  const graders = gradersAttempted(row.judgeAttempts);
  const triedAnother = graders.length > 1;
  const sure = confidenceFor(repair.reason, row);
  const safe = repair.retry === "safe";
  const urgency: DiagnosticReport["userAction"]["urgency"] =
    repair.owner === "Novera's graders" && !input.ownKey ? "none"
      : repair.retry === "check_first" || repair.retry === "fix_first" ? "immediate"
        : "optional";

  return {
    id: `${input.runId}:${input.caseRowId}`,
    runId: input.runId,
    scenarioId: input.scenarioId,
    category,
    reason: repair.reason,
    headline: `${CATEGORIES[category].name}: ${repair.happened}`,
    observedFacts: {
      startedAt: input.runStartedAt,
      recordedAt: input.recordedAt,
      stageReached: stageFor(repair.reason, category, row.replied),
      httpStatus: http ? Number(http[1]) : null,
      latencyMs: input.latencyMs,
      configuredTimeoutMs: input.agentTimeoutMs,
      targetUrlMasked: maskTargetUrl(input.agentUrl),
      agentReceived: repair.agentReceived,
      retestsRecorded: input.retestsRecorded,
      gradersAttempted: graders,
      replyFingerprintStored: input.replyFingerprintStored,
      reportSealed: input.reportSealed,
      storedError: row.error,
    },
    knownUnknowns: unknownsFor(repair.reason, row.replied),
    likelyCause: {
      hypothesis: repair.reason === "unclassified" ? "Not determined from the stored rows." : repair.happened,
      confidence: sure.confidence,
      supportingEvidence: sure.supportingEvidence,
    },
    userAction: {
      required: urgency !== "none",
      urgency,
      steps: [repair.next],
      owner: repair.owner,
    },
    noveraAction: {
      automatedResolutionAttempted: triedAnother,
      details: graders.length === 0
        ? "No AI grader was asked: there was no reply to grade, or the scenario was held back."
        : triedAnother
          ? `Novera made ${graders.length} grader requests in turn (${[...new Set(graders.map((g) => g.provider))].join(", ")}) and none produced a verdict it could use. Nothing is retried after the run; a retest is your call.`
          : "Novera asked one grader and it produced no usable verdict. Nothing is retried after the run; a retest is your call.",
    },
    retryPolicy: {
      isSafeToRetry: safe,
      recommendedDelayMs: delayFor(repair.reason),
      reasonIfBlocked: repair.retry === "fix_first"
        ? "Retesting gives the same answer until the cause is fixed."
        : repair.retry === "check_first"
          ? "The agent may already have acted on the first attempt; check your system before sending it again."
          : null,
    },
    technicalContext: {
      runId: input.runId,
      caseRowId: input.caseRowId,
      errorClass: repair.reason,
      documentationUrl: DIAGNOSTICS_DOC,
    },
  };
}

/** Counts per category, in the order a reader should take them: their own fixes first. */
export const CATEGORY_ORDER: readonly NoResultCategory[] = [
  "BLOCKED_CONFIG", "NOT_RUN", "COULD_NOT_COMPLETE", "RESULT_UNAVAILABLE", "INCONCLUSIVE", "BLOCKED_NOVERA", "WITHDRAWN_EXPIRED",
];

export function categoryCounts(categories: NoResultCategory[]): Array<{ category: NoResultCategory; count: number }> {
  return CATEGORY_ORDER.map((category) => ({ category, count: categories.filter((c) => c === category).length })).filter((x) => x.count > 0);
}
