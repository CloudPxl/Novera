import { isLimitSignal, quotedReason } from "../agents/upstream-error.ts";

/**
 * Why a scenario has no verdict, and what to do about it — read from what was stored.
 *
 * "No result" covers a dozen different facts, and they need different people: an agent
 * that timed out is the customer's engineer's problem, a grader that was rate-limited is
 * Novera's, a scenario the agent's template cannot carry is a configuration change, and a
 * claimed action nothing could check needs a read-back. Each is told apart here from the
 * typed fields first (evidence gap, read-back observation, judge agreement, the router's
 * attempt reasons) and then from the runner's own fixed sentences. Anything else is
 * `unclassified`, with the stored error shown as it is: a guess would be a new claim.
 *
 * Two questions matter before anyone presses retest: did the agent receive the scenario,
 * and could it have acted on it? A retest sends the scenario again. For an agent that
 * never received it that is harmless; for one that did, and can take actions, the first
 * attempt may already have done something in the customer's system.
 *
 * None of these is a failure of the agent's behaviour, so none is something a policy edit
 * fixes and none is offered a diagnosis: there is no reply-and-verdict for a model to
 * explain. The one partial exception is an unsettled disagreement, where a clearer
 * expected behaviour can help the graders agree; it says so.
 */

export type RepairReason =
  | "production_guard"
  | "no_metadata_slot"
  | "no_conversation_slot"
  | "cut_by_slice"
  | "not_sent_address"
  | "agent_timeout"
  | "agent_too_large"
  | "agent_http_error"
  | "agent_malformed"
  | "agent_rate_limited"
  | "agent_platform_error"
  | "agent_blocked_page"
  | "agent_stream_repeats"
  | "agent_response_path"
  | "agent_unreachable"
  | "readback_unavailable"
  | "action_not_verified"
  | "unsettled_disagreement"
  | "graders_rate_limited"
  | "graders_timed_out"
  | "graders_refused_data_class"
  | "graders_unreadable"
  | "graders_unavailable"
  | "unclassified";

export interface Repair {
  reason: RepairReason;
  /** A short name for the reason, for a list or a filter. */
  label: string;
  /** What happened, in one sentence. */
  happened: string;
  /** Whether the customer's agent received this scenario. */
  agentReceived: "yes" | "no" | "unknown";
  /** Whether sending it again could repeat something the agent did. */
  retry: "safe" | "check_first" | "fix_first";
  /** The one thing to do next. */
  next: string;
  /** Who acts on it. */
  owner: "your agent" | "your configuration" | "Novera's graders" | "a person";
  /** Whether a clearer policy or expected behaviour could change the outcome. */
  policyCanHelp: boolean;
}

export interface NoVerdictRow {
  status: string;
  error: string | null;
  /** Whether any reply was stored (or was, before retention emptied it). */
  replied: boolean;
  evidenceGap: string | null;
  judgeAgreement: string | null;
  observationStatus?: string | null;
  judgeAttempts: Array<{ ok?: unknown; reason?: unknown }>;
  /** The scenario claims an action (an `effect`) or is marked destructive. */
  actsOnTheWorld: boolean;
  /** Tool calls the agent reported for this scenario. */
  toolCalls: number;
}

/** What a retest would do, said for this scenario: who received it decides the sentence. */
export function retryWords(r: Pick<Repair, "retry" | "agentReceived">): string {
  if (r.retry === "fix_first") return "Retesting will give the same answer until the cause is fixed.";
  if (r.retry === "check_first") return "Retesting sends the scenario to your agent again. Check your system first: the first attempt may already have acted.";
  return r.agentReceived === "no"
    ? "Retest freely: your agent never received it, so nothing is repeated."
    : "Retest freely: this scenario asks your agent to take no action, and it reported none.";
}

/**
 * Why a scenario has no verdict. When the agent's platform said why (an error code and message,
 * stored quoted in the error since runner 1.2.0, or in the older stream wording), its words are
 * part of what happened: "the stream ended in an error" alone sent people looking in the wrong place.
 */
export function repairFor(row: NoVerdictRow): Repair | null {
  const repair = classify(row);
  if (!repair) return null;
  const quoted = quotedReason(row.error);
  if (!quoted || repair.happened.includes(quoted) || repair.owner === "Novera's graders") return repair;
  return { ...repair, happened: `${repair.happened} The agent's platform said: "${quoted}".` };
}

function classify(row: NoVerdictRow): Repair | null {
  if (row.status !== "error") return null;
  const error = row.error ?? "";
  // When the agent did receive it, whether a retry can repeat something depends on
  // whether it acts — by the scenario's own declaration, or by what it reported doing.
  const received = (): Pick<Repair, "agentReceived" | "retry"> => ({
    agentReceived: "yes",
    retry: row.actsOnTheWorld || row.toolCalls > 0 ? "check_first" : "safe",
  });
  const make = (r: Omit<Repair, "policyCanHelp"> & { policyCanHelp?: boolean }): Repair => ({ policyCanHelp: false, ...r });

  // Not run by Novera's own rules: the agent never saw it.
  if (/^This scenario attempts something irreversible|^This scenario is written against scripted test data/.test(error)) {
    return make({ reason: "production_guard", label: "Not run: production agent", owner: "your configuration", agentReceived: "no", retry: "fix_first",
      happened: "Not sent: this scenario is destructive or written for test data, and the agent is marked as serving real customers.",
      next: "Run it against a test copy of the agent, or mark this agent as a test target if it is one." });
  }
  if (/^This scenario delivers its input as conversation metadata/.test(error)) {
    return make({ reason: "no_metadata_slot", label: "Not run: no metadata channel", owner: "your configuration", agentReceived: "no", retry: "fix_first",
      happened: "Not sent: the attack arrives as conversation metadata, and the agent's request template has no {{context}} slot to carry it.",
      next: "Add a {{context}} slot to the agent's request template, if your agent reads metadata, or tick the delivery option on its Connection tab so the content is sent in the message (the report then says so). Then rerun." });
  }
  if (/^This scenario is a conversation, and this agent's request template has no/.test(error)) {
    return make({ reason: "no_conversation_slot", label: "Not run: no conversation channel", owner: "your configuration", agentReceived: "no", retry: "fix_first",
      happened: "Not sent: this is a conversation, and the agent's request template has no {{history}} or {{conversation_id}} slot.",
      next: "Add a {{messages}}, {{history}} or {{conversation_id}} slot to the agent's request template, or tick the delivery option on its Connection tab so earlier turns are sent in the message (the report then says so). Then rerun." });
  }
  if (/time slice was ending/.test(error)) {
    return make({ reason: "cut_by_slice", label: "Cut short by Novera", owner: "Novera's graders",
      // A stored reply settles it: the agent received the scenario and answered; only grading was cut.
      agentReceived: /^Not sent/.test(error) ? "no" : row.replied ? "yes" : "unknown",
      retry: /^Not sent/.test(error) ? "safe" : row.actsOnTheWorld ? "check_first" : "safe",
      happened: "Novera's time for this part of the run ran out around this scenario. It says nothing about the agent.",
      next: "Retest this scenario." });
  }
  if (/^Not sent:/.test(error)) {
    return make({ reason: "not_sent_address", label: "Not sent: address refused", owner: "your configuration", agentReceived: "no", retry: "fix_first",
      happened: "Not sent: the agent's address resolved to a private or internal network, which Novera never calls.",
      next: "Give the agent an address on the public internet, then retest." });
  }

  // A read-back or an action that nothing checked: the agent answered, the proof did not come.
  if (row.observationStatus === "unavailable") {
    return make({ reason: "readback_unavailable", label: "Read-back unavailable", owner: "your configuration", ...received(), retry: "check_first",
      happened: "The agent replied and described an action, but the read-only endpoint that would confirm it did not answer usably.",
      next: "Check the read-only endpoint on the agent's page (it says what it answered), then retest. The action may have happened." });
  }
  if (row.evidenceGap) {
    return make({ reason: "action_not_verified", label: "Action not verified", owner: "your configuration", ...received(), retry: "check_first",
      happened: row.evidenceGap === "no_state_evidence"
        ? "The scenario expects the agent to act. The graders read the reply as meeting it, and nothing independent confirmed the action: no read-only endpoint is configured."
        : "The agent said it called a tool, and its reply carried no record of the call.",
      next: row.evidenceGap === "no_state_evidence"
        ? "Configure a read-only endpoint on the agent's page so the action can be checked, then retest. Without one this scenario can reach a fail and never a pass: nothing confirms what the reply says was done."
        : "Point the agent's tool-activity path at where its replies list tool calls, then retest." });
  }
  if (row.judgeAgreement === "unresolved" && /^Two models disagreed/.test(error)) {
    return make({ reason: "unsettled_disagreement", label: "Graders could not agree", owner: "a person", ...received(), policyCanHelp: true,
      happened: "Two grading models read the reply differently and a third could not settle it.",
      next: "Read the reply and record your own finding on this scenario. A sharper expected behaviour in the suite can help the graders agree next time." });
  }

  // The agent was asked and did not give a usable reply.
  if (!row.replied) {
    if (/did not answer within|did not finish arriving within/.test(error)) {
      return make({ reason: "agent_timeout", label: "Agent timed out", owner: "your agent", agentReceived: "yes", retry: row.actsOnTheWorld ? "check_first" : "safe",
        happened: "The agent received the scenario and its reply did not arrive in time.",
        next: "Check the agent's latency, or raise its timeout on the agent's page (up to 30 s), then retest." });
    }
    if (/larger than \d+ KB/.test(error)) {
      return make({ reason: "agent_too_large", label: "Reply too large", owner: "your agent", ...received(),
        happened: "The agent's reply was larger than Novera reads, so it was not graded.",
        next: "Check what the agent returns for this message; a support reply is a few kilobytes." });
    }
    // A limit on how much or how fast, said by the platform: at the door (HTTP 429), in a 2xx
    // body, or inside a stream. The agent's availability, not its behaviour.
    const quoted = quotedReason(error);
    const limited = /refused it as over a limit|with an error instead of a reply, over a limit/.test(error)
      || /^Agent returned HTTP 429\b/.test(error)
      || (/stream ended with an error/.test(error) && isLimitSignal(quoted ? { code: null, message: quoted, status: null } : null));
    if (limited) {
      const atDoor = /^Agent returned HTTP 429\b/.test(error);
      return make({ reason: "agent_rate_limited", label: "Agent's platform over a limit", owner: "your agent",
        ...(atDoor ? { agentReceived: "no" as const, retry: "safe" as const } : received()),
        happened: atDoor
          ? "The agent's platform refused this scenario as over a rate, quota or concurrency limit, before the agent handled it."
          : "The agent's platform stopped this scenario as over a rate, quota or concurrency limit, so no reply came back.",
        next: "Check the platform's plan and limits (requests per minute, monthly quota, model credits), then retest. Novera waits and slows down when a platform says it is limited; a limit that does not lift stops the run." });
    }
    if (/answered with a web page|answered HTTP \d+ with a web page/.test(error)) {
      return make({ reason: "agent_blocked_page", label: "A web page answered", owner: "your configuration", agentReceived: "no", retry: "fix_first",
        happened: "A web page answered instead of the agent's API: a sign-in page, a firewall or a bot check usually answers like this, so the request did not reach the agent.",
        next: "Check the endpoint address, and allow Novera's requests through whatever is in front of the agent, then test the connection on the agent's page." });
    }
    if (/sends the whole reply so far in every event/.test(error)) {
      return make({ reason: "agent_stream_repeats", label: "Stream read the wrong way", owner: "your configuration", ...received(), retry: "fix_first",
        happened: "The agent streamed its reply as the whole text so far in every event, and the connection reads each event as the next piece, so the reply could not be put together without repeating text.",
        next: "Set the connection's stream to \"whole text\" on the agent's page, then retest." });
    }
    if (/step of the agent's workflow failed and no reply followed/.test(error)) {
      const twice = /on two attempts/.test(error);
      return make({ reason: "agent_platform_error", label: "A step of the agent's workflow failed", owner: "your agent", ...received(),
        happened: `A step inside the agent's workflow failed while handling this scenario, and no reply reached the customer${twice ? ", on two attempts" : ""}. From outside, this is the agent failing on the message, not a verdict on how it would have answered.`,
        next: "Open the agent's run log on its platform for this message and fix the step it names (often a tool or HTTP call the step depends on), then retest." });
    }
    if (/with an error instead of a reply/.test(error)) {
      return make({ reason: "agent_platform_error", label: "Agent's platform answered with an error", owner: "your agent", ...received(),
        happened: "The agent's platform answered with an error instead of a reply.",
        next: "Fix what the platform names in the agent's own configuration there (a missing input variable, a failed step, a model or key), test the connection, then retest." });
    }
    // Refused as too large before the agent read it. Said as what it is: a size or content rule in
    // front of the agent answered, and the agent's own handling of the message was never observed.
    // Not a pass: the scenario's expected behaviour is about the agent, and from outside a rule at
    // the door and an agent that would have done the right thing look the same.
    if (/^Agent returned HTTP 413\b/.test(error)) {
      return make({ reason: "agent_http_error", label: "Refused before the agent (HTTP 413)", owner: "your agent", agentReceived: "no", retry: "fix_first",
        happened: "Something in front of the agent refused this message as too large (HTTP 413) before the agent read it, so how the agent handles it was never observed. "
          + "A short message refused this way usually meets a content rule of a gateway or firewall rather than a size limit.",
        next: "Look for this request in the platform's gateway or firewall logs. If the rule is deliberate, the agent's behaviour on this input can only be observed on an address where the rule lets test traffic through; otherwise change the rule, then retest." });
    }
    const http = /^Agent returned HTTP (\d+)/.exec(error);
    if (http) {
      const code = Number(http[1]);
      const twice = /on two attempts/.test(error);
      return make({ reason: "agent_http_error", label: `Agent answered HTTP ${http[1]}${twice ? ", twice" : ""}`, owner: "your agent", ...received(),
        happened: twice
          ? `The agent's endpoint answered HTTP ${http[1]} to this scenario on two attempts, so it produced no reply to grade. `
            + "From outside, an input rejected by something in front of the agent and an agent that failed on the input look the same, so this is recorded as no result, not as a pass or a failure."
          : `The agent's endpoint answered with HTTP ${http[1]} instead of a reply.`,
        next: code === 401 || code === 403
          ? "Check the agent's auth header on its page, then retest. If a firewall or content filter in front of the agent rejects this input on purpose, that is the behaviour to note for this scenario."
          : twice
            ? "Look for this request in the agent's logs, and in any gateway or filter in front of it, then retest."
            : "Check the agent's logs for this request, then retest." });
    }
    if (/stream finished normally and carried no reply text/.test(error)) {
      return make({ reason: "agent_malformed", label: "Agent answered with nothing", owner: "your agent", ...received(),
        happened: "The agent's platform finished its answer normally, and the answer carried no text, so there was nothing to grade.",
        next: "Send the agent this message on its platform and follow the path it takes: on a workflow platform, a branch that ends without an answer step, or an answer step with empty text, ends this way. Then retest." });
    }
    if (/answered with an empty reply/.test(error)) {
      return make({ reason: "agent_malformed", label: "Agent answered with nothing", owner: "your agent", ...received(),
        happened: "The agent's endpoint answered, and the reply text was empty, so there was nothing to grade.",
        next: "Send the agent this message yourself and see whether it answers; an empty reply usually means the agent, or a filter on its output, withheld the text. Then retest." });
    }
    if (/stream ended with an error/.test(error)) {
      return make({ reason: "agent_platform_error", label: "Agent's stream ended in an error", owner: "your agent", ...received(),
        happened: quoted
          ? "The agent answered as a stream of events, and its platform ended the stream with an error before a reply."
          : "The agent answered as a stream of events, and its platform ended the stream with an error before a reply, without saying why.",
        next: "Fix what the platform names in the agent's own configuration there, test the connection on the agent's page, then retest." });
    }
    // Before runner 1.2.0 a stream that finished with no text was stored with this wording too,
    // so only the newer sentence (which lists the events) is read as a path to fix.
    if (/and none carried text at/.test(error) && !/The events were:/.test(error)) {
      return make({ reason: "agent_malformed", label: "Stream carried no reply", owner: "your agent", ...received(),
        happened: "The agent answered as a stream of events, and none of them carried reply text where the connection reads it. Either the agent said nothing, or its text is in a field the connection does not read.",
        next: "Test the connection on the agent's page: it lists the events the stream carries. Then retest." });
    }
    if (/and none carried text at/.test(error)) {
      return make({ reason: "agent_response_path", label: "Stream text not where expected", owner: "your configuration", ...received(), retry: "fix_first",
        happened: "The agent answered as a stream of events, and none of them carried reply text where the connection reads it.",
        next: "Test the connection on the agent's page: it lists the events the stream carried. Set the stream path to the field that holds the text, then retest." });
    }
    if (/not valid JSON/.test(error)) {
      return make({ reason: "agent_malformed", label: "Reply was not JSON", owner: "your agent", ...received(),
        happened: "The agent answered, and the answer was not JSON, so no reply could be read from it.",
        next: "Check what the endpoint returns; the agent's page can test it with one message." });
    }
    if (/^No text found at response path/.test(error)) {
      return make({ reason: "agent_response_path", label: "Reply not where expected", owner: "your configuration", ...received(), retry: "fix_first",
        happened: "The agent answered, and the reply was not at the response path configured for it.",
        next: "Fix the response path on the agent's page (it suggests one from the answer), then retest." });
    }
    if (/could not be asked|^Request failed|could not be read/.test(error)) {
      return make({ reason: "agent_unreachable", label: "Agent unreachable", owner: "your agent", agentReceived: "unknown",
        retry: row.actsOnTheWorld ? "check_first" : "safe",
        happened: "Novera could not complete the request to the agent; whether it arrived is not known.",
        next: "Check that the agent's endpoint is up and reachable from the internet, then retest." });
    }
  }

  // The agent replied; no grader produced a verdict.
  if (row.replied) {
    // An unreadable answer is recorded as answered (`ok`) with the reason `invalid_output`;
    // it is a failed attempt all the same, or "Verdict unreadable" could never be chosen.
    const failed = row.judgeAttempts.filter((a) => a.ok !== true || a.reason === "invalid_output").map((a) => String(a.reason ?? ""));
    const most = (r: string) => failed.length > 0 && failed.filter((x) => x === r).length * 2 >= failed.length;
    const graders = (reason: RepairReason, label: string, happened: string, next: string) =>
      make({ reason, label, owner: "Novera's graders", ...received(), happened, next });
    if (most("refused_data_class")) {
      return graders("graders_refused_data_class", "No grader allowed this data",
        "The reply contained data no available grader is approved to receive, so none was asked.",
        "Connect a model key whose provider may receive personal data (Settings), then retest.");
    }
    if (most("rate_limited")) {
      return graders("graders_rate_limited", "Graders rate-limited",
        "The agent replied; the grading models were rate-limited and none returned a verdict.",
        "Retest in a few minutes. On the trial keys, fewer runs at once helps; your own model key removes the shared limit.");
    }
    if (most("timed_out")) {
      return graders("graders_timed_out", "Graders timed out",
        "The agent replied; the grading models did not answer in time.",
        "Retest this scenario.");
    }
    if (most("invalid_output")) {
      return graders("graders_unreadable", "Verdict unreadable",
        "The agent replied; the grading models answered without a verdict Novera could read.",
        "Retest this scenario. If it repeats, the reply may be confusing the graders: read it yourself and record a finding.");
    }
    if (failed.length > 0 || /^Judge unavailable|No grader could answer/.test(error)) {
      return graders("graders_unavailable", "Graders unavailable",
        "The agent replied; no grading model could be reached.",
        "Retest this scenario. On your own model key, check the key on Settings.");
    }
  }

  return make({ reason: "unclassified", label: "No verdict", owner: "a person",
    agentReceived: row.replied ? "yes" : "unknown", retry: row.actsOnTheWorld ? "check_first" : "safe",
    happened: "No verdict was recorded, for a reason Novera did not store in a form it can classify. The stored error is shown with the scenario.",
    next: "Read the stored error, then retest." });
}

/**
 * The classifier's input from a stored `run_cases` row and the suite's definition of the
 * scenario — one constructor, so the run page and the review queue cannot read the same
 * row two ways.
 */
export function noVerdictRow(
  c: {
    status: unknown; error?: unknown; response_text?: unknown; raw_expired_at?: unknown; transcript?: unknown;
    evidence_gap?: unknown; judge_agreement?: unknown; judge_attempts?: unknown;
  },
  context: { observationStatus?: string | null; scenario?: { effect?: unknown; destructive?: unknown } | null; toolCalls?: number } = {},
): NoVerdictRow {
  const agentTurn = Array.isArray(c.transcript) && c.transcript.some((t) => (t as { role?: unknown })?.role === "agent");
  return {
    status: String(c.status),
    error: typeof c.error === "string" ? c.error : null,
    // An emptied reply (retention) was still a reply.
    replied: Boolean(c.response_text) || Boolean(c.raw_expired_at) || agentTurn,
    evidenceGap: typeof c.evidence_gap === "string" ? c.evidence_gap : null,
    judgeAgreement: typeof c.judge_agreement === "string" ? c.judge_agreement : null,
    observationStatus: context.observationStatus ?? null,
    judgeAttempts: Array.isArray(c.judge_attempts) ? (c.judge_attempts as NoVerdictRow["judgeAttempts"]) : [],
    actsOnTheWorld: Boolean(context.scenario?.effect) || Boolean(context.scenario?.destructive),
    toolCalls: context.toolCalls ?? 0,
  };
}
