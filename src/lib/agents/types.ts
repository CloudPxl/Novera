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
}

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
