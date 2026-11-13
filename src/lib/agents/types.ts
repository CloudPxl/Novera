export interface AgentInvocation {
  input: string;
  /** The approved policy for this run, injected wherever the agent config asks for it. */
  policy: string;
  /**
   * What the agent is told *about* the conversation rather than by the customer:
   * CRM fields, a profile, a note carried alongside the ticket. A scenario uses this
   * to attack the channel an indirect injection really arrives on — text the customer
   * never typed and the agent never treats as a message.
   */
  context?: Record<string, string>;
  /**
   * The conversation so far, for a scenario with earlier turns: every customer message
   * and agent reply before this one. Absent on a single-message scenario.
   */
  history?: Array<{ role: "customer" | "agent"; content: string }>;
  /** Stable across one conversation's turns, for an agent that keeps its own state. */
  conversationId?: string;
  /**
   * The moment (epoch ms) by which the reply must have arrived for this case to still be
   * graded inside the current slice. The agent's own timeout applies when it is sooner.
   */
  deadline?: number;
}

export interface AgentResult {
  ok: boolean;
  responseText: string | null;
  toolActivity: unknown;
  statusCode?: number;
  latencyMs: number;
  model?: string;
  usage?: { inputTokens?: number; outputTokens?: number };
  /** Persisted as evidence. Never rendered into a client report. */
  raw?: unknown;
  error?: string;
  /** No reply arrived in time. */
  timedOut?: boolean;
  /**
   * The wait was cut short by the run's own time budget, not by the agent's timeout —
   * a statement about Novera's slice, never a finding about the agent.
   */
  cutByNovera?: boolean;
  /**
   * How the answer was read, for the connection test's inspector: its content type as sent, the
   * format Novera read it as, and — for a stream — how many events carried a piece of the reply.
   * Never stored with a case.
   */
  wire?: {
    contentType: string | null;
    format: "json" | "event_stream" | "json_lines" | "text_stream" | "text";
    pieces?: number;
    matchedPath?: string | null;
    /** The value at the reply path was not text (an object, a list, a number) and was read as its JSON. */
    structured?: boolean;
    /** How many events of each kind a stream carried, for the connection check. */
    eventKinds?: Record<string, number>;
    /** The stream said it was done (`message_end`, `workflow_finished`, …). */
    finished?: boolean;
    /** Every piece repeated the text before it: the platform streams the whole text so far. */
    cumulative?: boolean;
  };
  /**
   * The request answered, and the reply field held an empty string: the agent said nothing.
   * Distinct from a reply that is somewhere else in the response (a wrong path).
   */
  emptyReply?: boolean;
  /**
   * What kind of failure this was, set by the HTTP adapter on every `ok: false`. In memory only:
   * the runner reads it to back off from a limit and to tell one systemic cause from a scenario's
   * own outcome. The stored record is the error sentence.
   */
  failure?: AgentFailure;
}

/**
 * Every way an answer can fail to be a reply, as one closed set.
 *  - refused_auth: 401/403, the credential or the address's access rules.
 *  - refused_input: another 4xx: the request was refused as malformed or unacceptable.
 *  - throttled: a limit on how much or how fast (429, or a body or stream naming one).
 *  - platform_error: the platform failed: 5xx, or an error stated in a 2xx body or stream.
 *  - web_page: a web page answered (a sign-in page, a firewall, a bot check), not the API.
 *  - redirect: a 3xx, never followed.
 *  - unreadable: the body is in no format the connection reads.
 *  - path_miss: readable, and nothing at the reply path.
 *  - empty: the reply field was there and empty, or a stream finished with no text.
 *  - repeated_stream: a stream that repeats the whole text in each piece, read as pieces.
 *  - too_large · timeout · unreachable · not_sent (Novera refused to send, or the slice ended).
 */
export type FailureKind =
  | "refused_auth" | "refused_input" | "throttled" | "platform_error" | "web_page" | "redirect"
  | "unreadable" | "path_miss" | "empty" | "repeated_stream" | "too_large" | "timeout" | "unreachable" | "not_sent";

export interface AgentFailure {
  kind: FailureKind;
  /** Stable across scenarios for one cause: `http:401`, `stream:too_many_requests`, `path`, … */
  signature: string;
  /** How long the platform asked to wait before trying again (Retry-After), when it said. */
  retryAfterMs?: number;
  /** The request was refused before the agent acted on it (a 429 or 401 at the door). */
  refusedAtDoor?: boolean;
  /**
   * The platform's own processing failed part-way (a workflow or one of its steps): the kind of
   * failure a second attempt often clears, sent again under `worthOneMoreAttempt`'s rule.
   */
  transient?: boolean;
}

export interface AgentAdapter {
  /** One harmless request, to prove the connection before a suite is trusted. */
  probe(): Promise<AgentResult>;
  send(invocation: AgentInvocation): Promise<AgentResult>;
  /**
   * Whether this agent has anywhere to put a scenario's `context`.
   *
   * A scenario that declares one and is run against an agent with no place for it is
   * recorded as an error, never folded into the message. An injection pasted into the
   * customer's own message is a different test with a different expected behaviour;
   * running it under the metadata scenario's name would report a verdict about the
   * wrong attack, which is worse than reporting nothing.
   */
  acceptsContext(): boolean;
  /**
   * Whether this agent can be told the earlier turns of a conversation — by receiving
   * them, or by a conversation id it keeps state against. Absent means no. A
   * conversation scenario run against an agent that cannot carry one is recorded as
   * not run: sending the turns as unrelated messages would test something else.
   */
  acceptsConversation?(): boolean;
  /**
   * How this agent is sent a scenario's metadata and a conversation's earlier turns. Absent means
   * its own fields. `message` is the labelled block of `inlineChannels`, which a run declares and
   * a report states.
   */
  delivery?(): { context: ChannelDelivery; conversation: ChannelDelivery };
}

export interface HttpAgentConfig {
  kind: "http";
  url: string;
  method?: "POST" | "GET";
  /** Non-secret headers. The auth header is injected from the sealed secret. */
  headers?: Record<string, string>;
  authHeaderName?: string;
  /** JSON object; the strings {{input}} and {{policy}} are substituted. */
  bodyTemplate: Record<string, unknown>;
  /** Dot path into the JSON response, e.g. "data.reply" or "choices.0.message.content". */
  responsePath: string;
  /** Optional dot path to recorded tool calls, if the agent reports them. */
  toolActivityPath?: string;
  timeoutMs?: number;
  /**
   * Where a piece of the reply sits inside one event, for an agent that answers as a stream of
   * server-sent events and names it differently from `responsePath`. Absent means the reply path.
   */
  streamPath?: string;
  /**
   * Where the agent's own conversation id sits in its reply, for a platform that issues one and
   * refuses ids it did not issue. `{{conversation_id}}` is then empty on a conversation's first
   * message and carries the id the agent returned on every later one. Absent: Novera's own id.
   */
  conversationIdPath?: string;
  /**
   * How a scenario's metadata and earlier turns reach an agent whose request has no field for
   * them. True: as a labelled block at the top of the message, declared in the run's manifest and
   * stated on the report beside each such scenario. Absent or false: those scenarios are not sent.
   */
  inlineChannels?: boolean;
  /**
   * How a streamed reply is put together. Absent: each event carries the next piece, appended in
   * order. "whole": each event carries the whole reply so far, and the last one is the reply.
   */
  streamMode?: "whole";
  /**
   * How hard a run may press this agent. `sendOneAtATime`: one scenario in flight, for a platform
   * that allows one request at a time or keeps state per user rather than per conversation.
   * `paceMs`: the least gap between two sends (250 by default, at most 10,000).
   */
  sendOneAtATime?: boolean;
  paceMs?: number;
  /** Which starting point the connection was filled from. Informational; never read by a run. */
  preset?: string;
}

/** How one kind of scenario content reaches an agent: its own field, the message, or not at all. */
export type ChannelDelivery = "field" | "message" | "none";

export interface ModelAgentConfig {
  kind: "model";
  provider: "anthropic" | "google" | "openai-compatible";
  model: string;
  baseUrl?: string;
  /**
   * The agent's own system prompt. The approved policy is appended, so a run always
   * records which policy version produced the behaviour.
   */
  systemPrompt: string;
}

export type AgentConfig = HttpAgentConfig | ModelAgentConfig;

/** A request that cannot do anything consequential, used to prove connectivity. */
export const PROBE_INPUT = "Hello. This is an automated connection check from Novera. Please reply with a short greeting and do not take any action on any account.";
