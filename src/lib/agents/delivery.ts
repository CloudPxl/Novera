import type { AgentInvocation, ChannelDelivery, HttpAgentConfig } from "./types.ts";
import { fillTemplate } from "./template.ts";

/**
 * What an HTTP agent is sent, and through which channel: the pure half of the adapter. No
 * network and nothing Node-only, so the run's manifest, the connection test and the connect form
 * all read the same answer the adapter acts on.
 */

/**
 * Whether the operator's body template has a given placeholder. Walked as a parsed
 * object, like `fillTemplate` itself, so a placeholder nested three levels inside the
 * template still counts.
 */
export function templateCarries(template: unknown, placeholder: string): boolean {
  if (typeof template === "string") return template.includes(placeholder);
  if (Array.isArray(template)) return template.some((t) => templateCarries(t, placeholder));
  if (template && typeof template === "object") {
    return Object.values(template as Record<string, unknown>).some((t) => templateCarries(t, placeholder));
  }
  return false;
}

/** The whole reply body is the reply: an endpoint that answers in plain text. */
export const WHOLE_BODY_PATH = "$text";

/** `{{conversation_id}}` in the address's path or query, for a platform that keys state by URL. */
export const URL_CONVERSATION = "{{conversation_id}}";

/** Whether this agent's request has a field of its own for a scenario's metadata. */
export function hasContextField(config: Pick<HttpAgentConfig, "bodyTemplate">): boolean {
  return templateCarries(config.bodyTemplate, "{{context}}");
}

/** Whether this agent's request can carry a conversation: the turns themselves, or an id it keeps state against. */
export function hasConversationField(config: Pick<HttpAgentConfig, "bodyTemplate" | "url">): boolean {
  return templateCarries(config.bodyTemplate, "{{history}}") || templateCarries(config.bodyTemplate, "{{messages}}")
    || templateCarries(config.bodyTemplate, "{{conversation_id}}") || config.url.includes(URL_CONVERSATION);
}

/** How this agent is sent metadata and earlier turns (`AgentAdapter.delivery`). */
export function deliveryOf(config: Pick<HttpAgentConfig, "bodyTemplate" | "url" | "inlineChannels">): { context: ChannelDelivery; conversation: ChannelDelivery } {
  const inline = config.inlineChannels === true;
  return {
    context: hasContextField(config) ? "field" : inline ? "message" : "none",
    conversation: hasConversationField(config) ? "field" : inline ? "message" : "none",
  };
}

/**
 * A scenario's metadata as a labelled block, for an agent with no field for it. Each entry keeps
 * the scenario's own key as its label and its value verbatim; nothing is added that tells the
 * agent how to treat it, because how it treats it is the test.
 */
export function contextBlock(context: Record<string, string>): string {
  return Object.entries(context).map(([key, value]) => `[${key}]\n${value}\n[/${key}]`).join("\n\n");
}

/** A conversation's earlier turns as a labelled block, with the agent's own replies as it gave them. */
export function historyBlock(history: NonNullable<AgentInvocation["history"]>): string {
  const lines = history.map((t) => `${t.role === "customer" ? "Customer" : "Assistant"}: ${t.content}`);
  return `[Earlier in this conversation]\n${lines.join("\n")}\n[/Earlier in this conversation]`;
}

/**
 * The message as this agent is sent it: the scenario's own text, preceded by its metadata and the
 * earlier turns when the agent has no field for them and the connection says to deliver them in
 * the message. One function, so the connection test shows exactly what a run sends.
 */
export function messageFor(
  config: Pick<HttpAgentConfig, "bodyTemplate" | "url" | "inlineChannels">,
  input: string,
  context?: Record<string, string>,
  history?: AgentInvocation["history"],
): string {
  const how = deliveryOf(config);
  const parts: string[] = [];
  if (context && Object.keys(context).length && how.context === "message") parts.push(contextBlock(context));
  if (history?.length && how.conversation === "message") parts.push(historyBlock(history));
  parts.push(input);
  return parts.join("\n\n");
}

/**
 * The JSON body one message is sent as. Exported so the connection test can show a person what
 * Novera sent, built by the code that sent it.
 */
export function requestBody(
  config: HttpAgentConfig,
  args: { input: string; policy: string; context?: Record<string, string>; history?: AgentInvocation["history"]; conversationId: string },
): unknown {
  const earlier = chatHistory(args.history);
  const message = messageFor(config, args.input, args.context, args.history);
  const messages = [...earlier, { role: "user" as const, content: message }];
  // A platform that issues its own conversation ids gets none on a conversation's first message:
  // the field is left out rather than sent empty, which some platforms refuse as invalid.
  const template = config.conversationIdPath && !args.conversationId ? withoutField(config.bodyTemplate, "{{conversation_id}}") : config.bodyTemplate;
  return fillTemplate(template, {
    input: message,
    policy: args.policy,
    // Serialised rather than spread, because the shape of a customer's metadata is
    // theirs, not ours: one placeholder carries whatever the scenario declared.
    context: JSON.stringify(args.context ?? {}),
    history: JSON.stringify(earlier),
    messages: JSON.stringify(messages),
    conversation_id: args.conversationId,
  }, { history: earlier, messages });
}

/** The conversation so far, in the role names chat APIs use. */
function chatHistory(history: AgentInvocation["history"]): Array<{ role: "user" | "assistant"; content: string }> {
  return (history ?? []).map((t) => ({ role: t.role === "customer" ? "user" : "assistant", content: t.content }));
}


/** The template without any field whose whole value is the placeholder, at any depth. */
export function withoutField(template: Record<string, unknown>, placeholder: string): Record<string, unknown> {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (value && typeof value === "object") {
      return Object.fromEntries(Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== placeholder).map(([k, v]) => [k, walk(v)]));
    }
    return value;
  };
  return walk(template) as Record<string, unknown>;
}
