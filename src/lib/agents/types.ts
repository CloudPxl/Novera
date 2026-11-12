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
  wire?: { contentType: string | null; format: "json" | "event_stream" | "text"; pieces?: number; matchedPath?: string | null };
  /**
   * The request answered, and the reply field held an empty string: the agent said nothing.
   * Distinct from a reply that is somewhere else in the response (a wrong path).
   */
  emptyReply?: boolean;
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
